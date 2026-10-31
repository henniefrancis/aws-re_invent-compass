// The Google Wallet REST client (Requirement 14). Over an injected fetch, so tests never
// reach Google.
//   insert: POST https://walletobjects.googleapis.com/walletobjects/v1/genericObject
//           a 409 means the object exists, so it is patched once with the same content
//   patch:  PATCH https://walletobjects.googleapis.com/walletobjects/v1/genericObject/{id}
// Any other failure, or a network error, is 'failed' and is not retried. The client never
// logs content, ids, keys or tokens.
// https://developers.google.com/wallet/generic/rest/v1/genericobject/insert
// https://developers.google.com/wallet/generic/rest/v1/genericobject/patch
import type { SecretsProvider } from '../credentials/secrets-provider.js';
import type { GenericObject } from './google-object.js';
import { SAFE_JWT_LENGTH, saveLink, signSaveJwt, type SaveJwtClaims } from './save-jwt.js';
import type { GoogleTokenSource } from './token-source.js';

export const GENERIC_OBJECT_URL =
  'https://walletobjects.googleapis.com/walletobjects/v1/genericObject';
export const GOOGLE_TIMEOUT_MS = 3000;

export type GoogleResult = 'ok' | 'failed';

export interface GoogleWalletClient {
  /** A 409 falls back to one patch. */
  insert(obj: GenericObject): Promise<GoogleResult>;
  patch(objectId: string, obj: Partial<GenericObject>): Promise<GoogleResult>;
  /**
   * The Save to Google Wallet links for these objects, in order. Each link holds as many
   * objects as keep its signed token within SAFE_JWT_LENGTH, measured on the token itself.
   * `oversize` is true only for a link that is still over (one object that alone is too long).
   */
  saveLinks(
    objects: { id: string; classId: string }[],
    nowSeconds: number,
  ): Promise<{ url: string; oversize: boolean; count: number }[]>;
}

export interface GoogleClientDeps {
  http: typeof fetch;
  tokens: GoogleTokenSource;
  secrets: SecretsProvider;
  timeoutMs?: number;
}

export function createGoogleWalletClient(deps: GoogleClientDeps): GoogleWalletClient {
  const timeoutMs = deps.timeoutMs ?? GOOGLE_TIMEOUT_MS;

  /** Sends one request and returns the HTTP status, or undefined on any error. */
  async function send(
    method: 'POST' | 'PATCH',
    url: string,
    body: unknown,
  ): Promise<number | undefined> {
    try {
      const token = await deps.tokens.accessToken();
      const response = await deps.http(url, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.arrayBuffer();
      return response.status;
    } catch {
      return undefined;
    }
  }

  async function patch(objectId: string, obj: Partial<GenericObject>): Promise<GoogleResult> {
    const status = await send(
      'PATCH',
      `${GENERIC_OBJECT_URL}/${encodeURIComponent(objectId)}`,
      obj,
    );
    return status !== undefined && status >= 200 && status < 300 ? 'ok' : 'failed';
  }

  return {
    async insert(obj) {
      const status = await send('POST', GENERIC_OBJECT_URL, obj);
      if (status === 409) {
        return patch(obj.id, obj);
      }
      return status !== undefined && status >= 200 && status < 300 ? 'ok' : 'failed';
    },

    patch,

    async saveLinks(objects, nowSeconds) {
      const google = await deps.secrets.google();
      const sign = (group: SaveJwtClaims['payload']['genericObjects']): string =>
        signSaveJwt(
          {
            iss: google.serviceAccount.client_email,
            aud: 'google',
            typ: 'savetowallet',
            iat: nowSeconds,
            origins: [],
            payload: { genericObjects: group },
          },
          google.serviceAccount.private_key,
        );
      const links: { url: string; oversize: boolean; count: number }[] = [];
      let group: typeof objects = [];
      let jwt = '';
      for (const object of objects) {
        const grown = sign([...group, object]);
        if (group.length > 0 && grown.length > SAFE_JWT_LENGTH) {
          links.push({ ...saveLink(jwt), count: group.length });
          group = [object];
          jwt = sign(group);
        } else {
          group = [...group, object];
          jwt = grown;
        }
      }
      if (group.length > 0) {
        links.push({ ...saveLink(jwt), count: group.length });
      }
      return links;
    },
  };
}
