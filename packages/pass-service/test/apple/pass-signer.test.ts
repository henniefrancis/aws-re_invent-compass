import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { MAX_BUNDLE_PASSES, chunkBundles, createPassSigner } from '../../src/apple/pass-signer.js';
import type { PassTemplateInput } from '../../src/apple/pass-template.js';
import { DependencyError } from '../../src/http/problem.js';
import { deriveAuthToken } from '../../src/security/auth-token.js';
import { appleSecretFromPki } from '../helpers/apple-secret.js';
import { createCapture } from '../helpers/capture.js';
import { createFakeSecrets } from '../helpers/fake-secrets.js';
import { passFieldsArb, samplePassFields } from '../helpers/pass-fields.js';
import { checkDetachedSignature } from '../helpers/pkcs7.js';
import { throwawayPki } from '../helpers/throwaway-pki.js';
import { zipMap } from '../helpers/zip-reader.js';

const TIMEOUT = 600_000;

function template(
  serialNumber: string,
  fields = samplePassFields(),
  extra: Record<string, unknown> = {},
): PassTemplateInput {
  return {
    serialNumber,
    fields,
    authToken: deriveAuthToken('pepper-pepper-pepper', serialNumber, 'salt'),
    webServiceUrl: 'https://d111111abcdef8.cloudfront.net/api/passkit',
    timezone: 'America/Los_Angeles',
    apple: { passTypeIdentifier: 'pass.test.compass', teamIdentifier: 'TESTTEAM01' },
    status: 'active',
    ...extra,
  };
}

function serial(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

function signer() {
  const secrets = createFakeSecrets({ apple: appleSecretFromPki() });
  const capture = createCapture();
  return { signer: createPassSigner(secrets, capture.console), secrets, capture };
}

/** Checks one .pkpass against the rules of Property 14 and returns its pass.json. */
function checkPass(pkpass: Uint8Array): Record<string, unknown> {
  const files = zipMap(pkpass);
  for (const name of [
    'pass.json',
    'manifest.json',
    'signature',
    'icon.png',
    'icon@2x.png',
    'icon@3x.png',
    'background.png',
  ]) {
    expect(files.has(name), name).toBe(true);
  }
  const manifest = JSON.parse(String(files.get('manifest.json'))) as Record<string, string>;
  for (const [name, hash] of Object.entries(manifest)) {
    expect(
      createHash('sha1')
        .update(files.get(name) as Buffer)
        .digest('hex'),
    ).toBe(hash);
  }
  expect(Object.keys(manifest).sort()).toEqual(
    [...files.keys()].filter((n) => n !== 'manifest.json' && n !== 'signature').sort(),
  );
  const check = checkDetachedSignature(
    files.get('signature') as Buffer,
    files.get('manifest.json') as Buffer,
    throwawayPki().signerCertPem,
  );
  expect(check.digestMatches).toBe(true);
  expect(check.signatureValid).toBe(true);
  expect(check.certificates).toHaveLength(2);
  return JSON.parse(String(files.get('pass.json'))) as Record<string, unknown>;
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, bundle chunks', () => {
  test('chunks keep order and hold at most ten', () => {
    expect(chunkBundles([])).toEqual([]);
    expect(chunkBundles([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    const items = Array.from({ length: 23 }, (_, i) => i);
    const chunks = chunkBundles(items);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 3]);
    expect(chunks.flat()).toEqual(items);
    expect(MAX_BUNDLE_PASSES).toBe(10);
  });
});

describe('Feature: pass-service, pass signer', () => {
  test('a signed pass carries the template, the artwork, no barcode and the dates', async () => {
    const { signer: s } = signer();
    const json = checkPass(await s.signPass(template(serial(1))));
    expect(json.serialNumber).toBe(serial(1));
    expect(json.expirationDate).toBe('2026-12-02T19:00:00.000Z');
    expect(json.sharingProhibited).toBe(true);
    expect(json.barcodes).toBeUndefined();
    expect(json.relevantDates).toEqual([
      { startDate: '2026-12-02T17:20:00.000Z', endDate: '2026-12-02T19:00:00.000Z' },
    ]);
    expect(json.voided).toBeUndefined();
    // Task 44: the owner's Pass Designer event ticket survives passkit-generator, the arrow
    // without a label included.
    expect(json.boardingPass).toBeUndefined();
    expect(json.posterGeneric).toBeUndefined();
    expect(json.preferredStyleSchemes).toBeUndefined();
    expect(json.organizationName).toBe('AWS Community South Africa');
    expect(json.semantics).toMatchObject({
      eventType: 'PKEventTypeGeneric',
      venueRegionName: 'Las Vegas',
      eventStartDate: '2026-12-02T18:00:00.000Z',
    });
    const ticket = json.eventTicket as Record<string, { key: string; label?: string }[]>;
    expect(ticket.headerFields?.map((f) => f.key)).toEqual(['session']);
    expect(ticket.primaryFields?.map((f) => f.key)).toEqual(['title']);
    expect(ticket.secondaryFields?.map((f) => f.key)).toEqual(['terminal', 'arrow', 'gate']);
    expect(ticket.secondaryFields?.[1]?.label).toBeUndefined();
    expect(ticket.auxiliaryFields?.map((f) => f.key)).toEqual(['date', 'boardingCloses']);
    // passkit-generator always writes the list for an event ticket; ours is empty.
    expect(ticket.additionalInfoFields ?? []).toEqual([]);
  });

  test('a voided pass keeps voided true and a past expiration date', async () => {
    const { signer: s } = signer();
    const json = checkPass(
      await s.signPass(
        template(serial(2), samplePassFields(), {
          status: 'voided',
          voidedAt: '2026-12-01T08:00:00.000Z',
        }),
      ),
    );
    expect(json.voided).toBe(true);
    expect(json.expirationDate).toBe('2026-12-01T08:00:00.000Z');
  });

  test('an unencrypted key with an empty passphrase also signs', async () => {
    const pki = throwawayPki();
    const secrets = createFakeSecrets({
      apple: {
        ...appleSecretFromPki(),
        signerKeyPem: pki.signerKeyPlainPem,
        signerKeyPassphrase: '',
      },
    });
    const s = createPassSigner(secrets, createCapture().console);
    checkPass(await s.signPass(template(serial(3))));
  });

  test(
    'signing stays fast, including a nine-digit fraction in the dates',
    async () => {
      const { signer: s } = signer();
      const fields = samplePassFields({
        startsAt: '2026-12-02T10:00:00.123456789-08:00',
        endsAt: '2026-12-02T11:00:00.123456789-08:00',
      });
      const start = Date.now();
      for (let i = 0; i < 5; i += 1) {
        await s.signPass(template(serial(10 + i), fields));
      }
      expect(Date.now() - start).toBeLessThan(15_000);
    },
    TIMEOUT,
  );

  test('a bad certificate is a signing dependency error carrying no key text', async () => {
    const secrets = createFakeSecrets({
      apple: { ...appleSecretFromPki(), signerCertPem: 'NEEDLE-not-a-certificate' },
    });
    const error = await createPassSigner(secrets, createCapture().console)
      .signPass(template(serial(4)))
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(DependencyError);
    expect((error as DependencyError).kind).toBe('signing');
    expect((error as Error).message).not.toContain('NEEDLE');
  });

  test('a bundle needs between one and ten passes', async () => {
    const { signer: s } = signer();
    await expect(s.signBundle([])).rejects.toBeInstanceOf(RangeError);
    await expect(
      s.signBundle(Array.from({ length: 11 }, (_, i) => template(serial(i)))),
    ).rejects.toBeInstanceOf(RangeError);
  });

  test('console output of the library never leaves a signing call', async () => {
    const { signer: s, capture } = signer();
    await s.signPass(template(serial(5)));
    expect(capture.consoleCalls).toEqual([]);
  });

  // Feature: pass-service, Property 14: Signed passes and bundles are intact
  test(
    'Property 14: signed passes and bundles are intact',
    async () => {
      const { signer: s } = signer();
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            { weight: 8, arbitrary: fc.array(passFieldsArb, { minLength: 1, maxLength: 1 }) },
            { weight: 1, arbitrary: fc.array(passFieldsArb, { minLength: 2, maxLength: 3 }) },
            { weight: 1, arbitrary: fc.array(passFieldsArb, { minLength: 10, maxLength: 10 }) },
          ),
          fc.boolean(),
          async (fieldsList, asBundle) => {
            const inputs = fieldsList.map((fields, i) => template(serial(100 + i), fields));
            if (asBundle) {
              const bundle = zipMap(await s.signBundle(inputs));
              expect([...bundle.keys()].sort()).toEqual(
                inputs.map((_, i) => `packed-pass-${i + 1}.pkpass`).sort(),
              );
              inputs.forEach((input, i) => {
                const json = checkPass(bundle.get(`packed-pass-${i + 1}.pkpass`) as Buffer);
                expect(json.serialNumber).toBe(input.serialNumber);
              });
            } else {
              const json = checkPass(await s.signPass(inputs[0] as PassTemplateInput));
              expect(json.serialNumber).toBe(inputs[0]?.serialNumber);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
    TIMEOUT,
  );
});
