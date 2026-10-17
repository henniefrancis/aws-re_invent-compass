# @compass/pass-service

The Compass API Lambdas of re:Invent Compass (stream S5). Two bundles, `api` and
`passkit`, sign unofficial Apple and Google Wallet boarding passes for signed-in
attendees, run Apple's PassKit web service, push pass updates and serve the
15-minute hand-off to the phone. The full README is written in task 25 of the
spec in `.kiro/specs/pass-service/`.

## ADR-026 re-check (task 22.7)

Read from the shipped `passkit-generator` 3.7.0 sources in `node_modules` (`lib/esm`):

- node-forge is used only in `Signature.js`: `pki.certificateFromPem` and `pki.decryptRsaPrivateKey` on
  the owner's own certificate and key, `pkcs7.createSignedData` and `sign` to create the detached
  signature, and the SHA-1 digest helpers. No file calls any node-forge verify function, so the
  advisory about RSA PKCS#1 v1.5 signature verification (GHSA-86w9-cpqp-85rv) does not apply to the code
  paths this service uses. The tests verify signatures with `node:crypto`, never with node-forge.
- joi validates dates with `isoDate()` only for `expirationDate`, `relevantDate`, relevant date intervals
  and semantic dates. This service never passes a client date string: `pass.json` is handed over without
  its dates, and the expiration and relevant dates are set with `Date` objects whose canonical
  24-character `toISOString()` form passkit-generator writes itself (review H1). Client text reaches joi
  only as the `value` of a pass field, which joi checks as a plain string first, and only after
  `createPassFieldsSchema` (with its date length bounds) has accepted it. No attacker-controlled message
  or schema reaches joi (GHSA-6h2x-m376-mqjq and GHSA-wr44-6hxh-3jwq).
- ADR-026 itself is unchanged by this review.
