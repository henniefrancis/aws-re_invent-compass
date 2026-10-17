// A loopback HTTP/2 server standing in for APNs. It requires a client certificate issued by
// the throwaway CA, records every push and answers each with a scripted status, reason and
// delay. It binds 127.0.0.1 only and uses the throwaway PKI.
import {
  createSecureServer,
  constants,
  type Http2SecureServer,
  type ServerHttp2Session,
} from 'node:http2';
import type { AddressInfo } from 'node:net';
import { throwawayPki } from './throwaway-pki.js';

export interface ScriptedReply {
  status: number;
  reason?: string;
  delayMs?: number;
  /** Close the stream with an error instead of answering. */
  reset?: boolean;
  /** Send a non-JSON body. */
  rawBody?: string;
}

export interface RecordedPush {
  method: string;
  path: string;
  topic: string | undefined;
  pushType: string | undefined;
  contentType: string | undefined;
  body: string;
  clientCommonName: string | undefined;
}

export interface ApnsStandIn {
  port: number;
  pushes: RecordedPush[];
  sessions: () => number;
  close: () => Promise<void>;
}

export async function startApnsStandIn(
  script: (token: string) => ScriptedReply,
): Promise<ApnsStandIn> {
  const pki = throwawayPki();
  const server: Http2SecureServer = createSecureServer({
    key: pki.serverKeyPem,
    cert: pki.serverCertPem,
    ca: pki.wwdrPem,
    requestCert: true,
    rejectUnauthorized: true,
  });
  const pushes: RecordedPush[] = [];
  const open: ServerHttp2Session[] = [];
  server.on('session', (session) => {
    open.push(session);
    session.on('error', () => undefined);
  });
  server.on('stream', (stream, headers) => {
    stream.on('error', () => undefined);
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      body += chunk;
    });
    stream.on('end', () => {
      const path = String(headers[':path']);
      const certificate = (
        stream.session?.socket as { getPeerCertificate?: () => { subject?: { CN?: string } } }
      ).getPeerCertificate?.();
      pushes.push({
        method: String(headers[':method']),
        path,
        topic: headers['apns-topic'] as string | undefined,
        pushType: headers['apns-push-type'] as string | undefined,
        contentType: headers['content-type'],
        body,
        clientCommonName: certificate?.subject?.CN,
      });
      const reply = script(path.replace('/3/device/', ''));
      setTimeout(() => {
        if (stream.destroyed || stream.closed) {
          return;
        }
        if (reply.reset === true) {
          stream.close(constants.NGHTTP2_INTERNAL_ERROR);
          return;
        }
        stream.respond({ ':status': reply.status, 'content-type': 'application/json' });
        stream.end(
          reply.rawBody ??
            (reply.reason === undefined ? '' : JSON.stringify({ reason: reply.reason })),
        );
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    pushes,
    sessions: () => open.length,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const session of open) {
          session.destroy();
        }
      }),
  };
}
