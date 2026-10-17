// The 15-minute hand-off (Requirements 15 and 16). The Handoff_Id is a capability: only its
// SHA-256 is stored. Every way a hand-off can be unusable (malformed, unknown, expired, read
// too often) is the same 404. A hand-off is not single-use within its 15 minutes, but reads
// are capped at 30 (review M4).
import type { ApiDeps } from '../app/deps.js';
import { chunkBundles } from '../apple/pass-signer.js';
import type { VerifiedCaller } from '../auth/token-verifier.js';
import { buildCalendar } from '../calendar/calendar-builder.js';
import { HANDOFF_LIFETIME_MS, ttlOf } from '../data/keys.js';
import type { HandoffRecord, PassRecord } from '../data/records.js';
import { googleObjectId } from '../google/google-object.js';
import { ProblemError } from '../http/problem.js';
import { HANDOFF_ID_PATTERN, newHandoffId } from '../security/handoff-id.js';
import { constantTimeEqualHex, sha256Hex } from '../security/hashing.js';
import type { CreateHandoffRequest } from '../validation/request-schemas.js';
import type { OpContext } from './op-context.js';
import { passTemplateInput } from './pass-template-input.js';

export type HandoffDeps = Pick<
  ApiDeps,
  'config' | 'random' | 'secrets' | 'limiter' | 'passes' | 'handoffs' | 'signer' | 'google'
>;

export interface HandoffView {
  expiresAt: string;
  sessions: { serialNumber: string; sessionCode: string; title: string; startsAt: string }[];
  apple: { bundlePaths: string[] };
  google: { saveUrl: string } | null;
  calendarPath: string | null;
}

export interface HandoffService {
  create(
    caller: VerifiedCaller,
    request: CreateHandoffRequest,
    op: OpContext,
  ): Promise<{ handoffId: string; boardUrl: string; expiresAt: string }>;
  view(handoffId: string, op: OpContext): Promise<HandoffView>;
  appleBundle(handoffId: string, index: number, op: OpContext): Promise<Uint8Array>;
  calendar(handoffId: string, op: OpContext): Promise<string>;
}

interface Resolved {
  handoff: HandoffRecord;
  /** The hand-off passes that are still live and active, in stored order. */
  active: PassRecord[];
}

function notFound(): ProblemError {
  return new ProblemError(404, 'not_found');
}

export function createHandoffService(deps: HandoffDeps): HandoffService {
  const { config, passes } = deps;

  async function resolve(handoffId: string, op: OpContext): Promise<Resolved> {
    if (!HANDOFF_ID_PATTERN.test(handoffId)) {
      throw notFound();
    }
    const hash = sha256Hex(handoffId);
    const handoff = await deps.handoffs.get(hash, op.now);
    if (handoff === undefined) {
      throw notFound();
    }
    if (!(await deps.limiter.consumeHandoffRead(handoff.subHash, hash, handoff.expiresAtMs))) {
      throw notFound();
    }
    const found = await Promise.all(
      handoff.serialNumbers.map((serial) => passes.get(serial, op.now)),
    );
    const active = found.filter(
      (rec): rec is PassRecord => rec !== undefined && rec.status === 'active',
    );
    return { handoff, active };
  }

  function appleChunks(active: PassRecord[]): PassRecord[][] {
    return chunkBundles(active.filter((rec) => rec.platforms.includes('apple')));
  }

  return {
    async create(caller, request, op) {
      const found = await Promise.all(
        request.serialNumbers.map((serial) => passes.get(serial, op.now)),
      );
      const usable = found.every(
        (rec) =>
          rec !== undefined &&
          rec.status === 'active' &&
          constantTimeEqualHex(rec.subHash, caller.subHash),
      );
      if (!usable) {
        throw new ProblemError(400, 'invalid_request');
      }
      const decision = await deps.limiter.consume(caller.subHash, 'handoffs', 1, op.now);
      if (!decision.allowed) {
        throw new ProblemError(429, 'rate_limited', {
          'retry-after': String(decision.retryAfterSeconds),
        });
      }
      const app = await deps.secrets.app();
      const handoffId = newHandoffId(deps.random);
      const expiresAtMs = op.now + HANDOFF_LIFETIME_MS;
      await deps.handoffs.create({
        handoffHash: sha256Hex(handoffId),
        subHash: caller.subHash,
        pepperId: app.pepperId,
        serialNumbers: request.serialNumbers,
        include: request.include,
        expiresAtMs,
        ttl: ttlOf(expiresAtMs),
      });
      return {
        handoffId,
        boardUrl: `${config.publicBaseUrl}/board#h=${handoffId}`,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    },

    async view(handoffId, op) {
      const { handoff, active } = await resolve(handoffId, op);
      const bundlePaths = handoff.include.apple
        ? appleChunks(active).map((_, i) => `/api/v1/handoffs/${handoffId}/apple/${i}`)
        : [];
      const withObject = active.filter((rec) => rec.googleState === 'active');
      let google: HandoffView['google'] = null;
      if (handoff.include.google && config.google.enabled && withObject.length > 0) {
        const secret = await deps.secrets.google();
        const classId = `${secret.issuerId}.${config.google.classSuffix}`;
        const link = await deps.google.saveUrl(
          withObject.map((rec) => ({
            id: googleObjectId(secret.issuerId, rec.serialNumber),
            classId,
          })),
          Math.floor(op.now / 1000),
        );
        op.metrics.add('GoogleSaveJwtOversize', link.oversize ? 1 : 0);
        google = { saveUrl: link.url };
      }
      return {
        expiresAt: new Date(handoff.expiresAtMs).toISOString(),
        sessions: active.map((rec) => ({
          serialNumber: rec.serialNumber,
          sessionCode: rec.sessionCode,
          title: rec.fields.title,
          startsAt: rec.fields.startsAt,
        })),
        apple: { bundlePaths },
        google,
        calendarPath:
          handoff.include.calendar && config.handoffCalendarEnabled
            ? `/api/v1/handoffs/${handoffId}/calendar.ics`
            : null,
      };
    },

    async appleBundle(handoffId, index, op) {
      const { handoff, active } = await resolve(handoffId, op);
      const chunk = handoff.include.apple ? appleChunks(active)[index] : undefined;
      if (chunk === undefined) {
        throw notFound();
      }
      const inputs = await Promise.all(
        chunk.map((rec) =>
          passTemplateInput(rec, {
            secrets: deps.secrets,
            publicBaseUrl: config.publicBaseUrl,
            passkitPath: config.passkitPath,
            timezone: config.eventWindow.timezone,
          }),
        ),
      );
      return deps.signer.signBundle(inputs);
    },

    async calendar(handoffId, op) {
      const { handoff, active } = await resolve(handoffId, op);
      if (!config.handoffCalendarEnabled) {
        throw new ProblemError(404, 'not_enabled');
      }
      if (!handoff.include.calendar) {
        throw notFound();
      }
      return buildCalendar(
        active.map((rec) => ({ serialNumber: rec.serialNumber, fields: rec.fields })),
        config.eventWindow.timezone,
      );
    },
  };
}
