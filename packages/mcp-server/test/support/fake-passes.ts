import type { NormalisedSession } from '@compass/contracts';
import { CompassError } from '../../src/ports/errors.js';
import type { PassesPort, ScheduleView, SyncPlan, SyncScope } from '../../src/ports/passes-port.js';
import type { RecordedCall } from './fake-events.js';

/** Calls that create, change or void a pass, or delete data. */
export const PASSES_WRITE_METHODS: readonly string[] = ['issue', 'handoff', 'sync', 'forgetMe'];

interface Entry {
  sessionId: string;
  sessionCode: string;
  serialNumber: string;
}

/**
 * A recording PassesPort with an in-memory issued-pass record. `sync` behaves like the real
 * S4 sync for the cases tests care about: it only touches passes inside `narrowTo`, and it
 * refuses to void every pass or more than five without the explicit flags.
 */
export class FakePasses implements PassesPort {
  readonly calls: RecordedCall[] = [];
  readonly failWith = new Map<string, Error>();
  entries: Entry[] = [];
  forgetResult: { ok: true } | { ok: false; summary: string } = { ok: true };
  handoffResult = {
    boardUrl: 'https://compass.invalid/board#h=AAAAAAAAAAAAAAAAAAAAAA',
    expiresAt: '2026-11-30T16:15:00.000Z',
    terminalQr: '##\n##',
    chatText: 'QR-TEXT',
    chatPng: new Uint8Array([137, 80, 78, 71]),
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>',
  };
  /** Sessions that stay voided after a sync, for tests that read the result. */
  voidedSerials: string[] = [];
  private counter = 0;

  get record(): { sessionCode: string; serialNumber: string }[] {
    return this.entries.map(({ sessionCode, serialNumber }) => ({ sessionCode, serialNumber }));
  }

  /** Adds an already issued pass without a call. */
  seed(sessionId: string, sessionCode: string): string {
    this.counter += 1;
    const serialNumber = `serial-${this.counter}`;
    this.entries.push({ sessionId, sessionCode, serialNumber });
    return serialNumber;
  }

  get writeCalls(): RecordedCall[] {
    return this.calls.filter((call) => PASSES_WRITE_METHODS.includes(call.method));
  }

  private run<T>(method: string, args: readonly unknown[], fn: () => T): Promise<T> {
    this.calls.push({ method, args });
    const error = this.failWith.get(method);
    if (error !== undefined) {
      return Promise.reject(error);
    }
    try {
      return Promise.resolve(fn());
    } catch (thrown) {
      return Promise.reject(thrown instanceof Error ? thrown : new Error('failed'));
    }
  }

  issue(
    sessions: readonly NormalisedSession[],
    schedule: ScheduleView,
  ): Promise<{ sessionId: string; serialNumber: string }[]> {
    return this.run(
      'issue',
      [sessions.map((s) => s.sessionId), schedule.sessions.length + schedule.personalTime.length],
      () =>
        sessions.map((session) => ({
          sessionId: session.sessionId,
          serialNumber: this.seed(session.sessionId, session.code),
        })),
    );
  }

  issuedRecord(): Promise<{ sessionCode: string; serialNumber: string }[]> {
    return this.run('issuedRecord', [], () => this.record);
  }

  handoff(serials: string[]): ReturnType<PassesPort['handoff']> {
    return this.run('handoff', [serials], () => this.handoffResult);
  }

  private plan(scope: SyncScope): SyncPlan {
    const inScope = this.entries.filter(
      (e) => scope.narrowCodes === undefined || scope.narrowCodes.has(e.sessionCode),
    );
    const resolvedIds = new Set(scope.resolved.map((s) => s.sessionId));
    const issuedIds = new Set(inScope.map((e) => e.sessionId));
    return {
      toIssue: scope.resolved.filter((s) => !issuedIds.has(s.sessionId)).map((s) => s.sessionId),
      toUpdate: scope.resolved.filter((s) => issuedIds.has(s.sessionId)).map((s) => s.sessionId),
      toVoid: inScope
        .filter((e) => !resolvedIds.has(e.sessionId))
        .map(({ sessionCode, serialNumber }) => ({ sessionCode, serialNumber })),
    };
  }

  previewSync(scope: SyncScope): Promise<SyncPlan> {
    return this.run(
      'previewSync',
      [
        scope.resolved.map((s) => s.sessionId),
        scope.narrowCodes === undefined ? undefined : [...scope.narrowCodes],
      ],
      () => this.plan(scope),
    );
  }

  sync(
    scope: SyncScope & { confirmEmpty: boolean; allowBulkVoid: boolean },
  ): Promise<{ issued: string[]; updated: string[]; voided: string[] }> {
    return this.run(
      'sync',
      [
        scope.resolved.map((s) => s.sessionId),
        scope.narrowCodes === undefined ? undefined : [...scope.narrowCodes],
        scope.confirmEmpty,
        scope.allowBulkVoid,
      ],
      () => {
        const plan = this.plan(scope);
        if (scope.resolved.length === 0 && plan.toVoid.length > 0 && !scope.confirmEmpty) {
          throw new CompassError('PassError', { summary: 'confirmEmpty is required' });
        }
        if (plan.toVoid.length > 5 && !scope.allowBulkVoid) {
          throw new CompassError('PassError', { summary: 'allowBulkVoid is required' });
        }
        const voidedSerials = new Set(plan.toVoid.map((v) => v.serialNumber));
        const voidedIds = this.entries
          .filter((e) => voidedSerials.has(e.serialNumber))
          .map((e) => e.sessionId);
        this.voidedSerials.push(...voidedSerials);
        this.entries = this.entries.filter((e) => !voidedSerials.has(e.serialNumber));
        for (const id of plan.toIssue) {
          const session = scope.resolved.find((s) => s.sessionId === id);
          if (session !== undefined) this.seed(id, session.code);
        }
        return { issued: plan.toIssue, updated: plan.toUpdate, voided: voidedIds };
      },
    );
  }

  exportCalendar(schedule: ScheduleView): Promise<{ ics: string; path: string }> {
    return this.run(
      'exportCalendar',
      [schedule.sessions.length + schedule.personalTime.length],
      () => ({
        ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
        path: 'calendar.ics',
      }),
    );
  }

  forgetMe(): Promise<{ ok: true } | { ok: false; summary: string }> {
    return this.run('forgetMe', [], () => this.forgetResult);
  }
}
