import { randomBytes } from 'node:crypto';
import type {
  AppSecret,
  OriginSecret,
  AppleSecret,
  GoogleSecret,
  SecretsProvider,
} from '../../src/secrets/secrets-provider.js';

/** A random value generated at test time. Nothing here is a real secret. */
export function randomValue(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export interface FakeSecrets extends SecretsProvider {
  appSecret: AppSecret;
  originSecret: OriginSecret;
  appleSecret: AppleSecret;
  googleSecret: GoogleSecret;
  reads: { app: number; origin: number; apple: number; google: number };
}

export interface FakeSecretsInit {
  app?: Partial<AppSecret>;
  origin?: Partial<OriginSecret>;
  apple?: Partial<AppleSecret>;
  google?: Partial<GoogleSecret>;
}

export function createFakeSecrets(init: FakeSecretsInit = {}): FakeSecrets {
  const appSecret: AppSecret = {
    pepper: randomValue(),
    pepperId: 'test-1',
    ...init.app,
  };
  const originSecret: OriginSecret = {
    originVerify: randomValue(),
    ...init.origin,
  };
  const appleSecret: AppleSecret = {
    passTypeIdentifier: 'pass.test.compass',
    teamIdentifier: 'TESTTEAM01',
    signerCertPem: 'unused',
    signerKeyPem: 'unused',
    signerKeyPassphrase: 'unused',
    wwdrPem: 'unused',
    ...init.apple,
  };
  const googleSecret: GoogleSecret = {
    issuerId: '3388000000099999999',
    serviceAccount: { client_email: 'svc@example.test', private_key: 'unused' },
    ...init.google,
  };
  const reads = { app: 0, origin: 0, apple: 0, google: 0 };
  return {
    appSecret,
    originSecret,
    appleSecret,
    googleSecret,
    reads,
    app: () => {
      reads.app += 1;
      return Promise.resolve(appSecret);
    },
    origin: () => {
      reads.origin += 1;
      return Promise.resolve(originSecret);
    },
    apple: () => {
      reads.apple += 1;
      return Promise.resolve(appleSecret);
    },
    google: () => {
      reads.google += 1;
      return Promise.resolve(googleSecret);
    },
  };
}
