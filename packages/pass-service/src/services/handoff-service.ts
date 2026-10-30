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
import { createGoogleInserter } from './google-inserter.js';
import type { OpContext } from './op-context.js';
import { passTemplateInput } from './pass-template-input.js';

/** The longest the hand-off view waits for Google insert retries (the board page waits 10 s). */
/** A failed Google insert is not tried again by a view for this long (per pass). */
export const GOOGLE_RETRY_COOLDOWN_MS = 60_000;

/** More passes than this never fit one save link (measured: 8 fit, 9 do not). */
export const MAX_TOP_LINK_PASSES = 8;

export const VIEW_INSERT_BUDGET_MS = 5_000;

export type HandoffDeps = Pick<
  ApiDeps,
  'config' | 'random' | 'secrets' | 'limiter' | 'passes' | 'handoffs' | 'signer' | 'google'
>;

export interface HandoffView {
  expiresAt: string;
  sessions: {
    serialNumber: string;
    sessionCode: string;
    title: string;
    startsAt: string;
    /** This session's own .pkpass route, when the hand-off includes Apple and the pass has it. */
    applePath: string | null;
    /** A save link for this session alone, when its Google object is active. */
    googleSaveUrl: string | null;
    /** This session's own calendar route, when the hand-off includes the calendar. */
    calendarPath: string | null;
  }[];
  apple: { bundlePaths: string[] };
  /** One link for every pass, present only when they all fit within SAFE_JWT_LENGTH. */
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
  applePass(handoffId: string, serialNumber: string, op: OpContext): Promise<Uint8Array>;
  calendar(handoffId: string, op: OpContext): Promise<string>;
  sessionCalendar(handoffId: string, serialNumber: string, op: OpContext): Promise<string>;
}

interface Resolved {
  handoff: HandoffRecord;
  /** The hand-off passes that are still live and active, in stored order. */
  active: PassRecord[];
}

function notFound(): ProblemError {
  return new ProblemError(404, 'not_found');
}

/** The hand-off's own active pass with this serial; anything else, valid or not, is none. */
function ownPass(active: PassRecord[], serialNumber: string): PassRecord | undefined {
  return active.find((rec) => rec.serialNumber === serialNumber);
}

export function createHandoffService(deps: HandoffDeps): HandoffService {
  const { config, passes } = deps;
  const inserter = createGoogleInserter(deps);

  async function resolve(handoffId: string, op: OpContext): Promise<Resolved> {
    if (!HANDOFF_ID_PATTERN.test(handoffId)) {
      throw notFound();
    }
    const hash = sha256Hex(handoffId);
    const handoff = await deps.handoffs.get(hash, op.now);
    if (handoff === undefined) {
      throw notFound();
    }
    // 30 reads plus 3 for every pass, so every button on the board page can be used once.
    if (
      !(await deps.limiter.consumeHandoffRead(
        handoff.subHash,
        hash,
        handoff.expiresAtMs,
        handoff.serialNumbers.length,
      ))
    ) {
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
      const wantsGoogle = handoff.include.google && config.google.enabled;
      // A pass whose insert failed or ran out of the budget is tried once more. Failures are
      // counted by the inserter and never stop the view. The retry is capped well inside the
      // board page's own 10 second timeout, so a slow Google never costs the Apple and
      // calendar links (QA Low-1).
      const retried = wantsGoogle
        ? await inserter.insertAll(
            active.filter(
              (rec) =>
                rec.platforms.includes('google') &&
                rec.googleState === 'none' &&
                (rec.googleRetryAfterMs ?? 0) <= op.now,
            ),
            op,
            VIEW_INSERT_BUDGET_MS,
            GOOGLE_RETRY_COOLDOWN_MS,
          )
        : new Set<string>();
      const withObject = active.filter(
        (rec) => rec.googleState === 'active' || retried.has(rec.serialNumber),
      );
      let google: HandoffView['google'] = null;
      const googleUrls = new Map<string, string>();
      if (handoff.include.google && config.google.enabled && withObject.length > 0) {
        // The view is still useful without the Google links: any failure here is counted and
        // the links are left out (review N4).
        try {
          const secret = await deps.secrets.google();
          const classId = `${secret.issuerId}.${config.google.classSuffix}`;
          const nowSeconds = Math.floor(op.now / 1000);
          const objectOf = (rec: PassRecord): { id: string; classId: string } => ({
            id: googleObjectId(secret.issuerId, rec.serialNumber),
            classId,
          });
          // One save link for each session: one object per token, far inside the safe length.
          const own = await Promise.all(
            withObject.map((rec) => deps.google.saveLinks([objectOf(rec)], nowSeconds)),
          );
          const single = own.map((links) => links[0] as { url: string; oversize: boolean });
          withObject.forEach((rec, i) =>
            googleUrls.set(rec.serialNumber, (single[i] as { url: string }).url),
          );
          op.metrics.add('GoogleSaveJwtOversize', single.filter((link) => link.oversize).length);
          // The top link is given only when every pass that wants Google has an object and
          // they all fit in one link. Above MAX_TOP_LINK_PASSES they cannot (about 9 passes
          // reach the safe length), so the all-in-one token is not even signed.
          const wanting = active.filter((rec) => rec.platforms.includes('google'));
          if (
            wanting.length > 0 &&
            wanting.length <= MAX_TOP_LINK_PASSES &&
            wanting.every((rec) => googleUrls.has(rec.serialNumber))
          ) {
            const all =
              wanting.length === 1
                ? [{ url: googleUrls.get((wanting[0] as PassRecord).serialNumber) as string }]
                : await deps.google.saveLinks(wanting.map(objectOf), nowSeconds);
            google = all.length === 1 ? { saveUrl: (all[0] as { url: string }).url } : null;
          }
        } catch {
          googleUrls.clear();
          op.metrics.add('GoogleWalletFailure', 1);
        }
      }
      return {
        expiresAt: new Date(handoff.expiresAtMs).toISOString(),
        sessions: active.map((rec) => ({
          serialNumber: rec.serialNumber,
          sessionCode: rec.sessionCode,
          title: rec.fields.title,
          startsAt: rec.fields.startsAt,
          applePath:
            handoff.include.apple && rec.platforms.includes('apple')
              ? `/api/v1/handoffs/${handoffId}/apple/pass/${rec.serialNumber}`
              : null,
          googleSaveUrl: googleUrls.get(rec.serialNumber) ?? null,
          calendarPath:
            handoff.include.calendar && config.handoffCalendarEnabled
              ? `/api/v1/handoffs/${handoffId}/calendar/${rec.serialNumber}.ics`
              : null,
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

    async applePass(handoffId, serialNumber, op) {
      const { handoff, active } = await resolve(handoffId, op);
      const rec = handoff.include.apple ? ownPass(active, serialNumber) : undefined;
      if (rec === undefined || !rec.platforms.includes('apple')) {
        throw notFound();
      }
      return deps.signer.signPass(
        await passTemplateInput(rec, {
          secrets: deps.secrets,
          publicBaseUrl: config.publicBaseUrl,
          passkitPath: config.passkitPath,
          timezone: config.eventWindow.timezone,
        }),
      );
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
        op.now,
      );
    },

    async sessionCalendar(handoffId, serialNumber, op) {
      const { handoff, active } = await resolve(handoffId, op);
      if (!config.handoffCalendarEnabled) {
        throw new ProblemError(404, 'not_enabled');
      }
      const rec = handoff.include.calendar ? ownPass(active, serialNumber) : undefined;
      if (rec === undefined) {
        throw notFound();
      }
      return buildCalendar(
        [{ serialNumber: rec.serialNumber, fields: rec.fields }],
        config.eventWindow.timezone,
        op.now,
      );
    },
  };
}
