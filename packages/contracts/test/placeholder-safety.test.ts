import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
// The scanner is an ESM .mjs under .github/scripts, imported by relative path. It
// is not in the coverage include set (only packages/*/src and spikes/src are), so
// this test checks behaviour without affecting coverage thresholds.
import { placeholderSafety } from '../../../.github/scripts/placeholder-safety.mjs';

// Property test for the placeholder and template-marker safety scanner
// (foundation-contracts, S0).
//
// Property 9: The safety scanner flags forbidden tokens and only those.
// Validates: Requirements 5.7, 5.8, 11.5, 12.10.
//
// The scanner flags, in any of the three Compass API copies (comments included):
//   - a bare twelve-digit run (a possible AWS account id);
//   - a hard-coded ARN ("arn:aws");
//   - any Terraform dollar-brace marker other than the two allowed Lambda invoke
//     placeholders, and any unterminated bare dollar-brace marker;
//   - any Terraform percent-brace marker.
// It flags ONLY those: content with none of them, including the two allowed
// placeholders and ordinary punctuation, is never flagged.

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');

const NUM_RUNS = 150;

// The two allowed dollar-brace placeholders.
const ALLOWED = ['${api_lambda_invoke_arn}', '${passkit_lambda_invoke_arn}'];

describe('Feature: foundation-contracts, Property 9: The safety scanner flags forbidden tokens and only those', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ph-safety-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function scan(content: string): Promise<{ ok: boolean; patterns: string[] }> {
    const file = join(dir, 'copy.yaml');
    await writeFile(file, content, 'utf8');
    const { ok, findings } = await placeholderSafety({ files: [file] });
    return { ok, patterns: findings.map((f) => f.pattern) };
  }

  // ----------------------------------------------------------------------------
  // Part A: safe content is never flagged. Letters, digits (in runs that are not
  // twelve long), spaces, basic punctuation and the two allowed placeholders.
  // ----------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 9: safe content is never flagged', async () => {
    const safeChar = fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?()/+#@-'.split(
        '',
      ),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.array(safeChar, { maxLength: 60 }).map((c) => c.join('')),
        fc.constantFrom(...ALLOWED, ''),
        async (text, placeholder) => {
          // Guard the generated text so it never accidentally contains a forbidden
          // token: no twelve-digit run, no arn:aws, no template markers (the safe
          // alphabet excludes $ % { }, so markers cannot form; filter long digit runs
          // and the arn literal to be safe).
          fc.pre(!/\d{12}/.test(text.replace(/\D/g, '')));
          const line = `title: ${text} ${placeholder}`;
          const { ok, patterns } = await scan(line);
          expect(patterns, `unexpected findings for: ${JSON.stringify(line)}`).toEqual([]);
          expect(ok).toBe(true);
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ----------------------------------------------------------------------------
  // Part B: each forbidden token is flagged. A clean base line plus exactly one
  // injected forbidden token must produce the matching finding.
  // ----------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 9: every forbidden token is flagged', async () => {
    const forbidden = fc.oneof(
      // A twelve-digit run.
      fc
        .array(fc.constantFrom(...'0123456789'.split('')), { minLength: 12, maxLength: 12 })
        .map((d) => ({ text: d.join(''), expect: 'twelve-digit run (possible account id)' })),
      // A hard-coded ARN.
      fc.constant({ text: 'arn:aws:lambda', expect: 'hard-coded ARN' }),
      // A disallowed dollar-brace marker (any name other than the two allowed).
      fc
        .string({ minLength: 1, maxLength: 10 })
        .filter((n) => /^[a-z_]+$/.test(n) && !['api_lambda_invoke_arn', 'passkit_lambda_invoke_arn'].includes(n))
        .map((name) => ({
          text: '${' + name + '}',
          expect: 'disallowed dollar-brace template marker',
        })),
      // An unterminated bare dollar-brace.
      fc.constant({ text: 'a ${ bare marker', expect: 'unterminated dollar-brace template marker' }),
      // A percent-brace marker.
      fc.constant({ text: '%{ for x in xs }', expect: 'percent-brace template marker' }),
    );

    await fc.assert(
      fc.asyncProperty(forbidden, async ({ text, expect: expectedPattern }) => {
        const { ok, patterns } = await scan(`# comment ${text} here`);
        expect(ok).toBe(false);
        expect(patterns).toContain(expectedPattern);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ----------------------------------------------------------------------------
  // Part C: the two allowed placeholders, on their own, are never flagged.
  // ----------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 9: the allowed placeholders are not flagged', async () => {
    for (const placeholder of ALLOWED) {
      const { ok, patterns } = await scan(`      uri: '${placeholder}'`);
      expect(patterns).toEqual([]);
      expect(ok).toBe(true);
    }
  });

  // ----------------------------------------------------------------------------
  // Part D: the three committed copies pass the scan.
  // ----------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 9: the committed copies pass the scan', async () => {
    const files = [
      resolve(repoRoot, 'contracts', 'compass-api.openapi.yaml'),
      resolve(repoRoot, 'packages', 'contracts', 'openapi.yaml'),
      resolve(repoRoot, 'infra', 'modules', 'api', 'openapi.yaml'),
    ];
    const { ok, findings } = await placeholderSafety({ files });
    expect(findings).toEqual([]);
    expect(ok).toBe(true);
  });
});
