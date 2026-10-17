// Hand-off fragment parser (showcase-site, Component 10).
//
// The /board page receives a 15-minute capability in the URL fragment, in exactly this form:
//
//   #h=<22 characters>
//
// The 22 characters are the unpadded base64url encoding of 16 random bytes. 16 bytes are 128
// bits and 22 characters carry 132, so the last character holds 2 data bits and 4 zero bits.
// In the canonical encoding it is therefore one of A, Q, g or w. Accepting only those refuses
// non-canonical, ambiguous ids. Nothing is trimmed, decoded or case folded.

export type HandoffId = string & { readonly __brand: 'HandoffId' };

export type FragmentResult = { readonly ok: true; readonly id: HandoffId } | { readonly ok: false };

const HANDOFF_FRAGMENT = /^#h=([A-Za-z0-9_-]{21}[AQgw])$/;

/** Read the hand-off id from a URL hash, or refuse it. */
export function parseBoardFragment(hash: string): FragmentResult {
  const match = HANDOFF_FRAGMENT.exec(hash);
  return match === null ? { ok: false } : { ok: true, id: match[1] as HandoffId };
}
