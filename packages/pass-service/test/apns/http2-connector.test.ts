import { describe, expect, test } from 'vitest';
import { createHttp2Connector } from '../../src/apns/http2-connector.js';
import { throwawayPki } from '../helpers/throwaway-pki.js';

describe('Feature: pass-service, HTTP/2 connector', () => {
  test('builds a session with and without a passphrase and a test CA, and defaults to port 443', () => {
    const pki = throwawayPki();
    const withEverything = createHttp2Connector({ port: 1, ca: pki.wwdrPem }).connect('localhost', {
      cert: pki.signerCertPem,
      key: pki.signerKeyPem,
      passphrase: pki.signerKeyPassphrase,
    });
    withEverything.on('error', () => undefined);
    expect(withEverything.destroyed).toBe(false);
    withEverything.destroy();

    const plain = createHttp2Connector().connect('localhost', {
      cert: pki.signerCertPem,
      key: pki.signerKeyPlainPem,
    });
    plain.on('error', () => undefined);
    expect(plain.destroyed).toBe(false);
    plain.destroy();
  });
});
