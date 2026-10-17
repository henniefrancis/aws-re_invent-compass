// Throwaway PKI, generated in memory at test time: a CA standing in for the Apple WWDR
// certificate, a Pass Type ID signer certificate issued by it, the signer key encrypted with
// a random passphrase, a loopback server certificate for the APNs stand-in, and a Google
// service account key pair. Nothing is written to disk and nothing here is a real secret.
import { generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import forge from 'node-forge';

export interface ThrowawayPki {
  wwdrPem: string;
  signerCertPem: string;
  signerKeyPem: string; // encrypted PKCS#8
  signerKeyPassphrase: string;
  signerKeyPlainPem: string; // the same key, unencrypted PKCS#8
  signerPublicKey: KeyObject;
  serverCertPem: string;
  serverKeyPem: string;
  google: { clientEmail: string; privateKeyPem: string; publicKey: KeyObject };
}

function rsa(): {
  privatePem: string;
  publicKey: KeyObject;
  forgePrivate: forge.pki.rsa.PrivateKey;
  forgePublic: forge.pki.rsa.PublicKey;
} {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
  return {
    privatePem,
    publicKey: pair.publicKey,
    forgePrivate: forge.pki.privateKeyFromPem(privatePem),
    forgePublic: forge.pki.publicKeyFromPem(publicPem),
  };
}

function serial(): string {
  return `01${randomBytes(8).toString('hex')}`;
}

function certificate(options: {
  subject: string;
  issuer: { subject: string; key: forge.pki.rsa.PrivateKey } | undefined;
  publicKey: forge.pki.rsa.PublicKey;
  signingKey: forge.pki.rsa.PrivateKey;
  extensions: object[];
}): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = options.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const subject = [{ name: 'commonName', value: options.subject }];
  cert.setSubject(subject);
  cert.setIssuer(
    options.issuer === undefined
      ? subject
      : [{ name: 'commonName', value: options.issuer.subject }],
  );
  cert.setExtensions(options.extensions);
  cert.sign(options.signingKey, forge.md.sha256.create());
  return cert;
}

let cached: ThrowawayPki | undefined;

/** Generated once per test file. */
export function throwawayPki(): ThrowawayPki {
  if (cached !== undefined) {
    return cached;
  }
  const ca = rsa();
  const caCert = certificate({
    subject: 'Throwaway WWDR stand-in',
    issuer: undefined,
    publicKey: ca.forgePublic,
    signingKey: ca.forgePrivate,
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true },
    ],
  });
  const caIssuer = { subject: 'Throwaway WWDR stand-in', key: ca.forgePrivate };

  const signer = rsa();
  const signerCert = certificate({
    subject: 'Throwaway Pass Type ID',
    issuer: caIssuer,
    publicKey: signer.forgePublic,
    signingKey: ca.forgePrivate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', clientAuth: true },
    ],
  });
  const passphrase = randomBytes(18).toString('base64url');

  const server = rsa();
  const serverCert = certificate({
    subject: 'localhost',
    issuer: caIssuer,
    publicKey: server.forgePublic,
    signingKey: ca.forgePrivate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  const google = rsa();
  cached = {
    wwdrPem: forge.pki.certificateToPem(caCert),
    signerCertPem: forge.pki.certificateToPem(signerCert),
    signerKeyPem: forge.pki.encryptRsaPrivateKey(signer.forgePrivate, passphrase, {
      algorithm: 'aes256',
    }),
    signerKeyPassphrase: passphrase,
    signerKeyPlainPem: signer.privatePem,
    signerPublicKey: signer.publicKey,
    serverCertPem: forge.pki.certificateToPem(serverCert),
    serverKeyPem: server.privatePem,
    google: {
      clientEmail: 'throwaway@example.test',
      privateKeyPem: google.privatePem,
      publicKey: google.publicKey,
    },
  };
  return cached;
}
