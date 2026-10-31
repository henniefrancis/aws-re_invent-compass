// Google inserts, shared by issue and by the hand-off view. A pass whose insert failed, or did
// not finish in the insert budget, stays googleState 'none'; the view tries it once more.
import type { ApiDeps } from '../app/deps.js';
import type { ApiConfig } from '../config/config.js';
import type { PassRecord } from '../data/records.js';
import { buildGenericObject, googleObjectId } from '../google/google-object.js';
import type { OpContext } from './op-context.js';

/** How many Google inserts run at once. */
export const GOOGLE_INSERT_CONCURRENCY = 5;

export type GoogleInserterDeps = Pick<ApiDeps, 'config' | 'secrets' | 'passes' | 'google'>;

export interface GoogleInserter {
  /** A Google call that never throws: false on any failure. Only used when Google is enabled. */
  call(run: (issuerId: string, classSuffix: string) => Promise<'ok' | 'failed'>): Promise<boolean>;
  /**
   * Inserts at most GOOGLE_INSERT_CONCURRENCY at a time and under an overall budget. Returns
   * the serial numbers that are now active. An insert that finishes after the budget still
   * marks its pass active, so a later read is honest. Every pass that did not make it counts
   * as one GoogleWalletFailure. `budgetCapMs` lowers the configured budget for a caller that
   * must answer sooner. A pass whose insert failed is not tried again by a caller that passes
   * `cooldownMs` until that long has passed. An object that cannot be marked active because the
   * pass was voided meanwhile is set INACTIVE at once and is not reported as added.
   */
  insertAll(
    records: PassRecord[],
    op: OpContext,
    budgetCapMs?: number,
    cooldownMs?: number,
  ): Promise<Set<string>>;
}

export function createGoogleInserter(deps: GoogleInserterDeps): GoogleInserter {
  const { config, passes } = deps;

  async function call(
    run: (issuerId: string, classSuffix: string) => Promise<'ok' | 'failed'>,
  ): Promise<boolean> {
    try {
      const secret = await deps.secrets.google();
      // Callers check `config.google.enabled` first.
      const { classSuffix } = config.google as Extract<ApiConfig['google'], { enabled: true }>;
      return (await run(secret.issuerId, classSuffix)) === 'ok';
    } catch {
      return false;
    }
  }

  function insertOne(rec: PassRecord): Promise<boolean> {
    return call((issuerId, classSuffix) =>
      deps.google.insert(
        buildGenericObject(
          {
            serialNumber: rec.serialNumber,
            fields: rec.fields,
            state: 'ACTIVE',
            timezone: config.eventWindow.timezone,
          },
          { issuerId, classSuffix, publicBaseUrl: config.publicBaseUrl },
        ),
      ),
    );
  }

  /** The pass was voided (or deleted) while its insert was in flight: switch the object off. */
  async function retireOrphan(rec: PassRecord): Promise<void> {
    const ok = await call((issuerId) =>
      deps.google.patch(googleObjectId(issuerId, rec.serialNumber), { state: 'INACTIVE' }),
    );
    await passes.setGoogleState(rec.serialNumber, ok ? 'inactive' : 'pending_inactive');
  }

  async function insertAll(
    records: PassRecord[],
    op: OpContext,
    budgetCapMs = Number.POSITIVE_INFINITY,
    cooldownMs = 0,
  ): Promise<Set<string>> {
    const done = new Set<string>();
    const queue = [...records];
    let expired = false;
    const worker = async (): Promise<void> => {
      for (let rec = queue.shift(); rec !== undefined && !expired; rec = queue.shift()) {
        if (await insertOne(rec)) {
          try {
            if (await passes.activateGoogle(rec.serialNumber)) {
              done.add(rec.serialNumber);
            } else {
              await retireOrphan(rec);
            }
          } catch {
            // The object exists but the record could not say so: it is reported as not inserted.
          }
        } else if (cooldownMs > 0) {
          await passes
            .setGoogleRetryAfter(rec.serialNumber, op.now + cooldownMs)
            .catch(() => undefined);
        }
      }
    };
    const budgetMs = Math.min(
      (config.google as Extract<ApiConfig['google'], { enabled: true }>).insertBudgetMs,
      budgetCapMs,
    );
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        expired = true;
        resolve();
      }, budgetMs);
    });
    try {
      const workers = Array.from(
        { length: Math.min(GOOGLE_INSERT_CONCURRENCY, records.length) },
        worker,
      );
      await Promise.race([Promise.all(workers), budget]);
    } finally {
      clearTimeout(timer);
    }
    const reported = new Set(done);
    op.metrics.add('GoogleWalletFailure', records.length - reported.size);
    return reported;
  }

  return { call, insertAll };
}
