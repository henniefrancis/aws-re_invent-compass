// APNs pass update pushes (Requirement 13, design Component 12).
//
// One HTTP/2 session per call, all streams concurrent, each bounded by `timeoutMs`, the
// whole call bounded by `budgetMs`. Request: POST /3/device/<pushToken> with `apns-topic`
// equal to the Pass Type ID, `apns-push-type` only when configured, and the body {}.
// 200 is delivered; 410, or 400 with reason BadDeviceToken, means the token is invalid;
// anything else is a failure. Nothing is retried. Every session and stream has an error
// listener (review L5), and no token, certificate or reply text is ever logged.
// Docs: https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
import type { ClientHttp2Session } from 'node:http2';
import type { ApiConfig } from '../config/config.js';
import type { SecretsProvider } from '../credentials/secrets-provider.js';
import type { Http2Connector } from './http2-connector.js';

export interface PushTarget {
  deviceHash: string;
  serialNumber: string;
  pushToken: string;
}

export interface PushOutcome {
  delivered: number;
  invalid: PushTarget[];
  failed: number;
  skipped: boolean;
}

export interface ApnsClient {
  push(targets: PushTarget[]): Promise<PushOutcome>;
}

export interface ApnsDeps {
  connector: Http2Connector;
  secrets: SecretsProvider;
}

type Result = 'delivered' | 'invalid' | 'failed';

/** The most reply text that is read from one push (review N10). */
export const MAX_REPLY_CHARS = 4096;

function classify(status: number | undefined, body: string): Result {
  if (status === 200) {
    return 'delivered';
  }
  if (status === 410) {
    return 'invalid';
  }
  if (status === 400) {
    try {
      const reason = (JSON.parse(body) as { reason?: unknown }).reason;
      return reason === 'BadDeviceToken' ? 'invalid' : 'failed';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}

function pushOne(
  session: ClientHttp2Session,
  target: PushTarget,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Result> {
  return new Promise<Result>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: Result): void => {
      clearTimeout(timer);
      resolve(result);
    };
    try {
      const stream = session.request({
        ':method': 'POST',
        ':path': `/3/device/${target.pushToken}`,
        ...headers,
      });
      let status: number | undefined;
      let body = '';
      timer = setTimeout(() => {
        stream.close();
        finish('failed');
      }, timeoutMs);
      stream.on('error', () => finish('failed'));
      stream.on('close', () => finish('failed'));
      stream.on('response', (responseHeaders) => {
        status = Number(responseHeaders[':status']);
      });
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        if (body.length + chunk.length > MAX_REPLY_CHARS) {
          // An APNs reply is a few dozen bytes; anything larger is not one.
          stream.close();
          finish('failed');
          return;
        }
        body += chunk;
      });
      stream.on('end', () => finish(classify(status, body)));
      stream.end('{}');
    } catch {
      finish('failed');
    }
  });
}

export function createApnsClient(cfg: ApiConfig['apns'], deps: ApnsDeps): ApnsClient {
  return {
    async push(targets) {
      if (!cfg.enabled) {
        return { delivered: 0, invalid: [], failed: 0, skipped: true };
      }
      if (targets.length === 0) {
        return { delivered: 0, invalid: [], failed: 0, skipped: false };
      }
      const apple = await deps.secrets.apple();
      const session = deps.connector.connect(cfg.host, {
        cert: apple.signerCertPem,
        key: apple.signerKeyPem,
        ...(apple.signerKeyPassphrase === '' ? {} : { passphrase: apple.signerKeyPassphrase }),
      });
      session.on('error', () => undefined);
      const headers: Record<string, string> = {
        'apns-topic': apple.passTypeIdentifier,
        ...(cfg.pushType === undefined ? {} : { 'apns-push-type': cfg.pushType }),
        'content-type': 'application/json',
      };
      const results: Result[] = targets.map(() => 'failed');
      let budgetTimer: NodeJS.Timeout | undefined;
      const budget = new Promise<void>((resolve) => {
        budgetTimer = setTimeout(resolve, cfg.budgetMs);
      });
      const all = Promise.all(
        targets.map(async (target, index) => {
          results[index] = await pushOne(session, target, headers, cfg.timeoutMs);
        }),
      );
      try {
        await Promise.race([all, budget]);
      } finally {
        clearTimeout(budgetTimer);
        session.destroy();
      }
      return {
        delivered: results.filter((r) => r === 'delivered').length,
        invalid: targets.filter((_, i) => results[i] === 'invalid'),
        failed: results.filter((r) => r === 'failed').length,
        skipped: false,
      };
    },
  };
}
