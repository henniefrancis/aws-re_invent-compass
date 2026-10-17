// OAuth access tokens for the Wallet API from the service account, through
// google-auth-library. The client is rebuilt only when the cached secret changes.
// Scope: https://developers.google.com/wallet/generic/rest/v1/genericobject/insert
import { JWT } from 'google-auth-library';
import type { GoogleSecret, SecretsProvider } from '../credentials/secrets-provider.js';

export const WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

export interface GoogleTokenSource {
  accessToken(): Promise<string>;
}

export interface TokenClient {
  getAccessToken(): Promise<{ token?: string | null }>;
}

export type TokenClientFactory = (email: string, key: string) => TokenClient;

const defaultFactory: TokenClientFactory = (email, key) =>
  new JWT({ email, key, scopes: [WALLET_SCOPE] });

export function createGoogleTokenSource(
  secrets: SecretsProvider,
  newClient: TokenClientFactory = defaultFactory,
): GoogleTokenSource {
  let built: { secret: GoogleSecret; client: TokenClient } | undefined;
  return {
    async accessToken() {
      const secret = await secrets.google();
      if (built?.secret !== secret) {
        built = {
          secret,
          client: newClient(secret.serviceAccount.client_email, secret.serviceAccount.private_key),
        };
      }
      const { token } = await built.client.getAccessToken();
      if (typeof token !== 'string' || token === '') {
        throw new Error('no access token');
      }
      return token;
    },
  };
}
