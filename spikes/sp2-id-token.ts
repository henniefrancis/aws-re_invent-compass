// SP2 spike: ID token verification (foundation-contracts, S0).
//
// This is a thin, operator-run wrapper. It is NOT a CI or test action: the test
// suite exercises the redaction logic in spikes/src/id-token-redact.ts directly
// and never runs this wrapper against a live token.
//
// Run directly under Node 24 with type stripping (no build step):
//   COMPASS_ID_TOKEN=<jwt> node spikes/sp2-id-token.ts
// or pass the token as the first argument.
//
// Behaviour:
//   1. Decode the token header and payload (no verification yet) and print a
//      REDACTED view: only alg, kid, iss, aud, token_use, exp values, and the
//      NAMES of every other claim. No other claim value is ever printed.
//   2. Read iss from the payload, fetch <iss>/.well-known/openid-configuration and
//      the JWKS it references, and verify the token with aws-jwt-verify, pinning
//      token_use=id and the shared Builder ID client id as aud.
//   3. On success print "verified". On failure print "verification failed" with
//      the error's name only, never a claim value.
//
// This file contains no em dash or en dash.

import { JwtVerifier } from 'aws-jwt-verify';
import { decodeJwtParts, redactDecodedToken, formatRedactedReport } from './src/id-token-redact.ts';

// The public, shared Builder ID client id (tech.md). It is not a secret.
const EXPECTED_AUD = '7vmom55m1qstvq8i71ph127bfq';

/**
 * Read the ID token from COMPASS_ID_TOKEN or the first CLI argument.
 */
function readToken(): string | undefined {
  return process.env.COMPASS_ID_TOKEN ?? process.argv[2];
}

async function main(): Promise<void> {
  const token = readToken();
  if (token === undefined || token.length === 0) {
    process.stderr.write(
      'No ID token provided. Set COMPASS_ID_TOKEN or pass the token as the first argument.\n',
    );
    process.exitCode = 1;
    return;
  }

  // 1. Decode and print the redacted view. This never prints a hidden claim value.
  const { header, payload } = decodeJwtParts(token);
  const redacted = redactDecodedToken(header, payload);
  for (const line of formatRedactedReport(redacted)) {
    process.stdout.write(`${line}\n`);
  }

  const iss = typeof payload.iss === 'string' ? payload.iss : undefined;
  if (iss === undefined) {
    process.stderr.write('verification failed: the token has no string iss claim\n');
    process.exitCode = 1;
    return;
  }

  // 2 and 3. Verify against the issuer JWKS. JwtVerifier discovers the JWKS URI
  // from the issuer. On any failure, report the error NAME only.
  try {
    const verifier = JwtVerifier.create({
      issuer: iss,
      audience: EXPECTED_AUD,
    });
    await verifier.verify(token, { tokenUse: 'id' } as never);
    process.stdout.write('verified\n');
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write(`verification failed: ${name}\n`);
    process.exitCode = 1;
  }
}

await main();
