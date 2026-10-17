// The pass lifecycle: issue, find, update, void (design Component 14, with the review
// amendments H2, H3 and M3).
//
// Stored changes always succeed for the attendee. APNs pushes and Google patches are best
// effort: a failure is counted as a metric and never changes the HTTP result. Update and
// void are counted against the pass-write budget but never refused. Over the update limits
// an update is stored and Last_Updated advances, but the fan-out is skipped; a void always
// fans out.
import type { PassFields } from '@compass/contracts';
import type { PushTarget } from '../apns/apns-client.js';
import type { ApiDeps } from '../app/deps.js';
import type { ApiConfig } from '../config/config.js';
import type { VerifiedCaller } from '../auth/token-verifier.js';
import { EXPIRY_GRACE_MS, ttlOf } from '../data/keys.js';
import { nextLastUpdated } from '../data/last-updated.js';
import { ACTIVE_PASS_LIMIT } from '../data/rate-limiter.js';
import type { DeviceRegistration, PassRecord } from '../data/records.js';
import { buildGenericObject, googleObjectId, type GenericObject } from '../google/google-object.js';
import { ProblemError } from '../http/problem.js';
import { deriveAuthToken, newTokenSalt } from '../security/auth-token.js';
import { constantTimeEqualHex, sha256Hex } from '../security/hashing.js';
import { UUID_V4_PATTERN } from '../security/handoff-id.js';
import type { IssuePassesRequest } from '../validation/request-schemas.js';
import type { OpContext } from './op-context.js';

export type LifecycleDeps = Pick<
  ApiDeps,
  'config' | 'random' | 'secrets' | 'limiter' | 'passes' | 'registrations' | 'apns' | 'google'
>;

export interface IssuedPass {
  serialNumber: string;
  sessionCode: string;
  platforms: ('apple' | 'google')[];
}

export interface PassLifecycle {
  issue(
    caller: VerifiedCaller,
    request: IssuePassesRequest,
    op: OpContext,
  ): Promise<{ passes: IssuedPass[] }>;
  /** The caller's own live pass. Unknown, expired, foreign and malformed are the same 404. */
  find(caller: VerifiedCaller, serial: string, now: number): Promise<PassRecord>;
  update(
    caller: VerifiedCaller,
    serial: string,
    fields: PassFields,
    op: OpContext,
  ): Promise<{ serialNumber: string; version: number }>;
  void(
    caller: VerifiedCaller,
    serial: string,
    op: OpContext,
  ): Promise<{ serialNumber: string; status: 'voided' }>;
  /** Stores the void and fans it out. 'already' when the pass was voided before. */
  voidRecord(rec: PassRecord, op: OpContext): Promise<'voided' | 'already'>;
  /**
   * The push and the Google patch of a void, from in-memory copies. forget_me runs this after
   * it has deleted the items, so it must not need the table.
   */
  fanOutVoid(
    rec: PassRecord,
    registrations: DeviceRegistration[],
    op: OpContext,
    persist: boolean,
  ): Promise<void>;
}

function notFound(): ProblemError {
  return new ProblemError(404, 'not_found');
}

function toTarget(reg: DeviceRegistration): PushTarget {
  return { deviceHash: reg.deviceHash, serialNumber: reg.serialNumber, pushToken: reg.pushToken };
}

export function createPassLifecycle(deps: LifecycleDeps): PassLifecycle {
  const { config, passes, registrations, limiter } = deps;

  async function pushAll(regs: DeviceRegistration[], op: OpContext): Promise<void> {
    if (regs.length === 0) {
      return;
    }
    let outcome;
    try {
      outcome = await deps.apns.push(regs.map(toTarget));
    } catch {
      op.metrics.add('ApnsFailure', regs.length);
      return;
    }
    if (outcome.skipped) {
      op.metrics.add('ApnsSkipped', 1);
      return;
    }
    for (const target of outcome.invalid) {
      await registrations.delete(target.deviceHash, target.serialNumber);
    }
    op.metrics.add('ApnsInvalidToken', outcome.invalid.length);
    op.metrics.add('ApnsFailure', outcome.failed);
  }

  /** A Google call that never throws: false on any failure. Only used when Google is enabled. */
  async function googleCall(
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

  /** True when the pass has a Google object and Google is enabled by configuration. */
  function hasGoogleObject(rec: PassRecord): boolean {
    return config.google.enabled && rec.googleState === 'active';
  }

  async function patchInactive(rec: PassRecord, op: OpContext): Promise<boolean> {
    const ok = await googleCall((issuerId) =>
      deps.google.patch(googleObjectId(issuerId, rec.serialNumber), { state: 'INACTIVE' }),
    );
    op.metrics.add('GoogleWalletFailure', ok ? 0 : 1);
    return ok;
  }

  async function patchContent(rec: PassRecord, op: OpContext): Promise<void> {
    const ok = await googleCall((issuerId, classSuffix) => {
      const object: GenericObject = buildGenericObject(
        {
          serialNumber: rec.serialNumber,
          fields: rec.fields,
          state: 'ACTIVE',
          timezone: config.eventWindow.timezone,
        },
        { issuerId, classSuffix },
      );
      return deps.google.patch(object.id, object);
    });
    op.metrics.add('GoogleWalletFailure', ok ? 0 : 1);
  }

  async function insertGoogle(rec: PassRecord, op: OpContext): Promise<boolean> {
    const ok = await googleCall((issuerId, classSuffix) =>
      deps.google.insert(
        buildGenericObject(
          {
            serialNumber: rec.serialNumber,
            fields: rec.fields,
            state: 'ACTIVE',
            timezone: config.eventWindow.timezone,
          },
          { issuerId, classSuffix },
        ),
      ),
    );
    op.metrics.add('GoogleWalletFailure', ok ? 0 : 1);
    return ok;
  }

  /**
   * Saves a changed copy under a version check. After one conflict the pass is read again and
   * the change rebuilt; a second conflict is an error (never a silent overwrite). `build`
   * returns undefined when the fresh copy no longer allows the change.
   */
  async function saveVersioned(
    start: PassRecord,
    op: OpContext,
    build: (current: PassRecord) => PassRecord | undefined,
  ): Promise<PassRecord | undefined> {
    let current: PassRecord | undefined = start;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (current === undefined) {
        return undefined;
      }
      const next = build(current);
      if (next === undefined) {
        return undefined;
      }
      if ((await passes.save(next, current.version)) === 'ok') {
        return next;
      }
      current = await passes.get(start.serialNumber, op.now);
    }
    throw new Error('version conflict');
  }

  async function fanOutVoid(
    rec: PassRecord,
    regs: DeviceRegistration[],
    op: OpContext,
    persist: boolean,
  ): Promise<void> {
    await pushAll(regs, op);
    if (hasGoogleObject(rec)) {
      const ok = await patchInactive(rec, op);
      if (persist) {
        await passes.setGoogleState(rec.serialNumber, ok ? 'inactive' : 'pending_inactive');
      }
    }
  }

  const lifecycle: PassLifecycle = {
    async issue(caller, request, op) {
      const count = request.passes.length;
      const live = await passes.listBySub(caller.subHash, op.now);
      const active = live.filter((rec) => rec.status === 'active').length;
      if (active + count > ACTIVE_PASS_LIMIT) {
        throw new ProblemError(429, 'active_pass_limit');
      }
      const decision = await limiter.consume(caller.subHash, 'passWrites', count, op.now);
      if (!decision.allowed) {
        throw new ProblemError(429, 'rate_limited', {
          'retry-after': String(decision.retryAfterSeconds),
        });
      }
      const app = await deps.secrets.app();
      const wantsGoogle = request.platforms.includes('google') && config.google.enabled;
      const issued: IssuedPass[] = [];
      for (const fields of request.passes) {
        const serialNumber = deps.random.uuid();
        const tokenSalt = newTokenSalt(deps.random);
        const token = deriveAuthToken(app.pepper, serialNumber, tokenSalt);
        const expiresAtMs = Date.parse(fields.endsAt) + EXPIRY_GRACE_MS;
        const rec: PassRecord = {
          serialNumber,
          subHash: caller.subHash,
          pepperId: app.pepperId,
          sessionCode: fields.sessionCode,
          fields,
          platforms: request.platforms,
          authTokenHash: sha256Hex(token),
          tokenSalt,
          status: 'active',
          version: 1,
          lastUpdatedMs: Math.floor(op.now / 1000) * 1000,
          googleState: 'none',
          createdAtMs: op.now,
          expiresAtMs,
          ttl: ttlOf(expiresAtMs),
        };
        await passes.create(rec);
        const googleOk = wantsGoogle && (await insertGoogle(rec, op));
        if (googleOk) {
          await passes.setGoogleState(serialNumber, 'active');
        }
        issued.push({
          serialNumber,
          sessionCode: fields.sessionCode,
          platforms: request.platforms.filter((platform) => platform === 'apple' || googleOk),
        });
      }
      return { passes: issued };
    },

    async find(caller, serial, now) {
      if (!UUID_V4_PATTERN.test(serial)) {
        throw notFound();
      }
      const rec = await passes.get(serial, now);
      if (rec === undefined || !constantTimeEqualHex(rec.subHash, caller.subHash)) {
        throw notFound();
      }
      return rec;
    },

    async update(caller, serial, fields, op) {
      const rec = await lifecycle.find(caller, serial, op.now);
      if (rec.status === 'voided') {
        throw notFound();
      }
      if (fields.sessionCode !== rec.sessionCode) {
        throw new ProblemError(400, 'invalid_request');
      }
      await limiter.record(rec.subHash, 'passWrites', 1, op.now);
      const [perSub, perPass] = await Promise.all([
        limiter.consume(rec.subHash, 'updates', 1, op.now),
        limiter.consume(rec.subHash, 'passUpdate', 1, op.now, serial),
      ]);
      const saved = await saveVersioned(rec, op, (current) => {
        if (current.status === 'voided') {
          return undefined;
        }
        const expiresAtMs = Date.parse(fields.endsAt) + EXPIRY_GRACE_MS;
        return {
          ...current,
          fields,
          version: current.version + 1,
          lastUpdatedMs: nextLastUpdated(current.lastUpdatedMs, op.now),
          expiresAtMs,
          ttl: ttlOf(expiresAtMs),
        };
      });
      if (saved === undefined) {
        throw notFound();
      }
      await registrations.extendExpiry(serial, saved.expiresAtMs, op.now);
      if (perSub.allowed && perPass.allowed) {
        await pushAll(await registrations.listByPass(serial, op.now), op);
        if (hasGoogleObject(saved)) {
          await patchContent(saved, op);
        }
      }
      return { serialNumber: serial, version: saved.version };
    },

    async void(caller, serial, op) {
      const rec = await lifecycle.find(caller, serial, op.now);
      await lifecycle.voidRecord(rec, op);
      return { serialNumber: serial, status: 'voided' };
    },

    async voidRecord(rec, op) {
      if (rec.status === 'voided') {
        if (config.google.enabled && rec.googleState === 'pending_inactive') {
          const ok = await patchInactive(rec, op);
          await passes.setGoogleState(rec.serialNumber, ok ? 'inactive' : 'pending_inactive');
        }
        return 'already';
      }
      await limiter.record(rec.subHash, 'passWrites', 1, op.now);
      const saved = await saveVersioned(rec, op, (current) =>
        current.status === 'voided'
          ? undefined
          : {
              ...current,
              status: 'voided',
              voidedAt: new Date(op.now).toISOString(),
              version: current.version + 1,
              lastUpdatedMs: nextLastUpdated(current.lastUpdatedMs, op.now),
            },
      );
      if (saved === undefined) {
        return 'already';
      }
      await fanOutVoid(saved, await registrations.listByPass(rec.serialNumber, op.now), op, true);
      return 'voided';
    },

    fanOutVoid,
  };
  return lifecycle;
}
