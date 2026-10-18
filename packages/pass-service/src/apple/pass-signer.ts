// Signs Apple passes and bundles with passkit-generator 3.7.0 (design Component 11).
//
// Everything is built in memory: pass.json and the artwork go in as buffers and the signed
// .pkpass comes out as a buffer. No file is read or written, and nothing is stored.
//
// Review H1: no client date string reaches passkit-generator (which validates dates with
// joi). pass.json is handed over without its dates, and the expiration and relevant dates
// are set afterwards with Date objects built from Date.parse. Client text reaches joi only
// as field values, which it checks as plain strings.
import { PKPass } from 'passkit-generator';
import { DependencyError } from '../http/problem.js';
import { withConsoleGuard, type ConsoleLike } from '../observability/console-guard.js';
import type { SecretsProvider } from '../credentials/secrets-provider.js';
import { ARTWORK } from './artwork.js';
import { buildPassJson, type PassTemplateInput } from './pass-template.js';

export const MAX_BUNDLE_PASSES = 10;

export interface PassSigner {
  /** A signed .pkpass. */
  signPass(input: PassTemplateInput): Promise<Uint8Array>;
  /** A signed .pkpasses of 1 to 10 passes. */
  signBundle(inputs: PassTemplateInput[]): Promise<Uint8Array>;
}

/** Splits items into consecutive chunks of at most `size`, keeping their order. */
export function chunkBundles<T>(items: readonly T[], size = MAX_BUNDLE_PASSES): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

type Certificates = ConstructorParameters<typeof PKPass>[1];

function dateOf(canonical: string): Date {
  return new Date(Date.parse(canonical));
}

function build(input: PassTemplateInput, certificates: Certificates): PKPass {
  const { expirationDate, relevantDates, ...rest } = buildPassJson(input);
  const buffers: Record<string, Buffer> = {
    'pass.json': Buffer.from(JSON.stringify(rest), 'utf8'),
  };
  for (const [name, base64] of Object.entries(ARTWORK)) {
    buffers[name] = Buffer.from(base64, 'base64');
  }
  const pass = new PKPass(buffers, certificates);
  pass.setBarcodes(null);
  pass.setExpirationDate(dateOf(expirationDate));
  pass.setRelevantDates(
    relevantDates.map((interval) => ({
      startDate: dateOf(interval.startDate),
      endDate: dateOf(interval.endDate),
    })),
  );
  return pass;
}

export function createPassSigner(
  secrets: SecretsProvider,
  console: ConsoleLike = globalThis.console,
): PassSigner {
  async function certificates(): Promise<Certificates> {
    const apple = await secrets.apple();
    return {
      wwdr: apple.wwdrPem,
      signerCert: apple.signerCertPem,
      signerKey: apple.signerKeyPem,
      // passkit-generator refuses an empty passphrase: an unencrypted key sends none.
      ...(apple.signerKeyPassphrase === ''
        ? {}
        : { signerKeyPassphrase: apple.signerKeyPassphrase }),
    };
  }

  /** Runs the signing inside the console guard; any failure is a signing dependency error. */
  async function guarded(run: () => Buffer): Promise<Uint8Array> {
    try {
      return await withConsoleGuard(console, () => Promise.resolve(run()));
    } catch {
      throw new DependencyError('signing');
    }
  }

  return {
    async signPass(input) {
      const certs = await certificates();
      return guarded(() => build(input, certs).getAsBuffer());
    },

    async signBundle(inputs) {
      if (inputs.length < 1 || inputs.length > MAX_BUNDLE_PASSES) {
        throw new RangeError('a bundle holds 1 to 10 passes');
      }
      const certs = await certificates();
      return guarded(() =>
        PKPass.pack(...inputs.map((input) => build(input, certs))).getAsBuffer(),
      );
    },
  };
}
