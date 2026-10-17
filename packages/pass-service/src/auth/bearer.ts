// Parsing of the Authorization header: "Bearer " and three base64url segments, at most
// 8192 characters. Anything else is refused by the caller as the same 401.
export const MAX_BEARER_LENGTH = 8192;

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

export function parseBearer(value: string | undefined): string | undefined {
  if (value === undefined || value.length > MAX_BEARER_LENGTH) {
    return undefined;
  }
  return BEARER_PATTERN.exec(value)?.[1];
}
