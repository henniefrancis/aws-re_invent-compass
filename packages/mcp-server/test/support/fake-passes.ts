import type { Commitment, NormalisedSession } from '@compass/contracts';
import type { PassesPort } from '../../src/ports/passes-port.js';
import type { RecordedCall } from './fake-events.js';

/** Calls that create, change or void a pass, or delete data. */
export const PASSES_WRITE_METHODS: readonly string[] = ['issue', 'handoff', 'sync', 'forgetMe'];

/** A recording PassesPort with an in-memory issued-pass record. */
export class FakePasses implements PassesPort {
  readonly calls: RecordedCall[] = [];
  readonly failWith = new Map<string, Error>();
  record: { sessionCode: string; serialNumber: string }[] = [];
  forgetResult: { ok: true } | { ok: false; summary: string } = { ok: true };
  syncResult: { issued: string[]; updated: string[]; voided: string[] } = {
    issued: [],
    updated: [],
    voided: [],
  };
  handoffResult = {
    boardUrl: 'https://compass.invalid/board#h=AAAAAAAAAAAAAAAAAAAAAA',
    expiresAt: '2026-11-30T16:15:00.000Z',
    terminalQr: '##\n##',
    chatText: 'QR-TEXT',
    chatPng: new Uint8Array([137, 80, 78, 71]),
  };
  private counter = 0;

  get writeCalls(): RecordedCall[] {
    return this.calls.filter((call) => PASSES_WRITE_METHODS.includes(call.method));
  }

  private run<T>(method: string, args: readonly unknown[], fn: () => T): Promise<T> {
    this.calls.push({ method, args });
    const error = this.failWith.get(method);
    if (error !== undefined) {
      return Promise.reject(error);
    }
    return Promise.resolve(fn());
  }

  issue(
    sessions: readonly NormalisedSession[],
    itinerary: readonly Commitment[],
  ): Promise<{ sessionId: string; serialNumber: string }[]> {
    return this.run('issue', [sessions.map((s) => s.sessionId), itinerary.length], () =>
      sessions.map((session) => {
        this.counter += 1;
        const serialNumber = `serial-${this.counter}`;
        this.record.push({ sessionCode: session.code, serialNumber });
        return { sessionId: session.sessionId, serialNumber };
      }),
    );
  }

  issuedRecord(): Promise<{ sessionCode: string; serialNumber: string }[]> {
    return this.run('issuedRecord', [], () => this.record.map((entry) => ({ ...entry })));
  }

  handoff(serials: string[]): ReturnType<PassesPort['handoff']> {
    return this.run('handoff', [serials], () => this.handoffResult);
  }

  sync(
    resolved: readonly NormalisedSession[],
    narrowTo?: ReadonlySet<string>,
  ): Promise<{ issued: string[]; updated: string[]; voided: string[] }> {
    return this.run(
      'sync',
      [resolved.map((s) => s.sessionId), narrowTo === undefined ? undefined : [...narrowTo]],
      () => this.syncResult,
    );
  }

  exportCalendar(commitments: readonly Commitment[]): Promise<{ ics: string; path: string }> {
    return this.run('exportCalendar', [commitments.length], () => ({
      ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
      path: 'calendar.ics',
    }));
  }

  forgetMe(): Promise<{ ok: true } | { ok: false; summary: string }> {
    return this.run('forgetMe', [], () => this.forgetResult);
  }
}
