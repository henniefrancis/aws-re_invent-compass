import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createRedactingLogger } from '../../src/api/redacting-logger.js';

// Security regression tests for logger needles (events-client, S1, finding M4): the
// encoded forms of a registered secret, the Basic scheme, and form and JSON keys.

function capture(): { logger: ReturnType<typeof createRedactingLogger>; lines: string[] } {
  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(line);
  };
  return { logger: createRedactingLogger({ info: push, warn: push, error: push }), lines };
}

const secretArb = fc.string({ minLength: 6, maxLength: 30 }).filter((s) => s.trim().length > 5);

describe('events-client, M4: registered secrets cover their encoded forms', () => {
  test('a secret is scrubbed as given, percent-encoded and form-encoded', () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        const { logger, lines } = capture();
        logger.addSecret(secret);
        const forms = [
          secret,
          encodeURIComponent(secret),
          new URLSearchParams({ k: secret }).toString().slice(2),
        ];
        for (const form of forms) {
          logger.info(`value=${form} end`);
        }
        for (const line of lines) {
          for (const form of forms) {
            expect(line).not.toContain(form);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  test('removeSecret removes every form again', () => {
    const { logger, lines } = capture();
    logger.addSecret('a secret/with+chars');
    logger.removeSecret('a secret/with+chars');
    logger.info(`x ${encodeURIComponent('a secret/with+chars')} y`);
    expect(lines[0]).toContain('a%20secret%2Fwith%2Bchars');
    logger.removeSecret(undefined);
    logger.removeSecret('');
  });
});

describe('events-client, M4: structural patterns for Basic, form keys and JSON keys', () => {
  test('Basic credentials are redacted in a header and when bare', () => {
    const { logger, lines } = capture();
    logger.info('Authorization: Basic dXNlcjpwYXNzd29yZA==');
    logger.info('proxy-authorization: Basic dXNlcjpwYXNzd29yZA==');
    logger.info('sent basic dXNlcjpwYXNzd29yZA== to proxy');
    logger.info('a basic configuration is fine');
    expect(lines[0]).toBe('Authorization: Basic [REDACTED]');
    expect(lines[1]).toBe('proxy-authorization: Basic [REDACTED]');
    expect(lines[2]).toBe('sent basic [REDACTED] to proxy');
    expect(lines[3]).toBe('a basic configuration is fine');
  });

  test('refresh_token, code_verifier, code, access_token and id_token form values are redacted', () => {
    const { logger, lines } = capture();
    logger.info('grant_type=refresh_token&refresh_token=abc123XYZ&client_id=c1');
    logger.info('code_verifier=v3rifier-value&code=auth-code-1');
    logger.info('GET /callback?code=zzz&state=s1');
    logger.info('access_token=AT1&id_token=IT1');
    expect(lines[0]).toBe('grant_type=refresh_token&refresh_token=[REDACTED]&client_id=c1');
    expect(lines[1]).toBe('code_verifier=[REDACTED]&code=[REDACTED]');
    expect(lines[2]).toBe('GET /callback?code=[REDACTED]&state=s1');
    expect(lines[3]).toBe('access_token=[REDACTED]&id_token=[REDACTED]');
  });

  test('the same keys in a JSON body are redacted', () => {
    const { logger, lines } = capture();
    logger.info(
      '{"refresh_token":"opaque-refresh","access_token": "opaque-access","expires_in":3600}',
    );
    logger.info('{"code_verifier":"ver","id_token":"idtok"}');
    expect(lines[0]).not.toContain('opaque-refresh');
    expect(lines[0]).not.toContain('opaque-access');
    expect(lines[0]).toContain('"expires_in":3600');
    expect(lines[1]).toBe('{"code_verifier":"[REDACTED]","id_token":"[REDACTED]"}');
  });
});
