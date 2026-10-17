// The Save to Google Wallet link: an RS256 JWT signed with the service account key.
// Claims: iss (service account email), aud "google", typ "savetowallet", iat, origins [],
// payload.genericObjects of {id, classId}. Referencing already inserted objects by id keeps
// the token short. "The safe length of an encoded JWT is 1800 characters."
// https://developers.google.com/wallet/generic/use-cases/jwt
// https://developers.google.com/wallet/generic/web
import { createSign } from 'node:crypto';

export const SAVE_URL_PREFIX = 'https://pay.google.com/gp/v/save/';
export const SAFE_JWT_LENGTH = 1800;

export interface SaveJwtClaims {
  iss: string;
  aud: 'google';
  typ: 'savetowallet';
  iat: number;
  origins: string[];
  payload: { genericObjects: { id: string; classId: string }[] };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function signSaveJwt(claims: SaveJwtClaims, privateKeyPem: string): string {
  const data = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256').update(data).sign(privateKeyPem, 'base64url');
  return `${data}.${signature}`;
}

export function saveLink(jwt: string): { url: string; oversize: boolean } {
  return { url: `${SAVE_URL_PREFIX}${jwt}`, oversize: jwt.length > SAFE_JWT_LENGTH };
}
