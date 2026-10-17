// Starts the owner-run local harness (SP3 and SP4). Run it with:
//   node packages/pass-service/scripts/run.mjs packages/pass-service/scripts/local-harness.ts
// It reads the Compass environment variables the Lambdas use, plus the harness variables
// below, and prints only "listening" and one log line per request.
//   HARNESS_HOST, HARNESS_PORT                      where to listen (default 0.0.0.0 and 8443)
//   HARNESS_PASS_TYPE_ID, HARNESS_TEAM_ID           your Apple identifiers
//   HARNESS_SIGNER_CERT_FILE, HARNESS_SIGNER_KEY_FILE, HARNESS_WWDR_FILE   PEM files
//   HARNESS_SIGNER_KEY_PASSPHRASE                   only when the key file is encrypted
//   HARNESS_GOOGLE_KEY_FILE, HARNESS_GOOGLE_ISSUER_ID   only for the Google spike
import { startLocalHarness } from '../src/harness/local-server.js';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
  return value;
}

const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[name] = value;
  }
}

await startLocalHarness({
  host: process.env.HARNESS_HOST ?? '0.0.0.0',
  port: Number(process.env.HARNESS_PORT ?? '8443'),
  env,
  secrets: {
    passTypeIdentifier: required('HARNESS_PASS_TYPE_ID'),
    teamIdentifier: required('HARNESS_TEAM_ID'),
    signerCertFile: required('HARNESS_SIGNER_CERT_FILE'),
    signerKeyFile: required('HARNESS_SIGNER_KEY_FILE'),
    wwdrFile: required('HARNESS_WWDR_FILE'),
    ...(process.env.HARNESS_SIGNER_KEY_PASSPHRASE === undefined
      ? {}
      : { signerKeyPassphrase: process.env.HARNESS_SIGNER_KEY_PASSPHRASE }),
    ...(process.env.HARNESS_GOOGLE_KEY_FILE === undefined
      ? {}
      : { googleKeyFile: process.env.HARNESS_GOOGLE_KEY_FILE }),
    ...(process.env.HARNESS_GOOGLE_ISSUER_ID === undefined
      ? {}
      : { googleIssuerId: process.env.HARNESS_GOOGLE_ISSUER_ID }),
  },
});
