import type { AppleSecret } from '../../src/credentials/secrets-provider.js';
import { throwawayPki } from './throwaway-pki.js';

/** An apple-pass secret built from the throwaway PKI. Made-up identifiers. */
export function appleSecretFromPki(): AppleSecret {
  const pki = throwawayPki();
  return {
    passTypeIdentifier: 'pass.test.compass',
    teamIdentifier: 'TESTTEAM01',
    signerCertPem: pki.signerCertPem,
    signerKeyPem: pki.signerKeyPem,
    signerKeyPassphrase: pki.signerKeyPassphrase,
    wwdrPem: pki.wwdrPem,
  };
}
