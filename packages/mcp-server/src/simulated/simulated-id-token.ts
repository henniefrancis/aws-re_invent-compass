// The ID token used in simulated mode. It is built locally, signed by nobody and valid nowhere:
// the shape S4's client insists on (three parts, `token_use` of `id`), so the same code path runs,
// while the In_Process_Pass_Service is the only thing that ever sees it.

function part(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A jwt-shaped token with no signature that no real service would accept. */
export function simulatedIdToken(): string {
  return `${part({ alg: 'none' })}.${part({ token_use: 'id', sub: 'simulated' })}.c2ln`;
}
