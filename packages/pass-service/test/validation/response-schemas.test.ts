import { describe, expect, test } from 'vitest';
import {
  CreateHandoffResponseSchema,
  ForgetMeResponseSchema,
  HandoffViewSchema,
  HealthSchema,
  IssuePassesResponseSchema,
  SerialNumbersSchema,
  UpdatePassResponseSchema,
  VoidPassResponseSchema,
} from '../../src/validation/response-schemas.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('Feature: pass-service, response schemas', () => {
  test('valid bodies parse', () => {
    expect(HealthSchema.parse({ status: 'ok', version: '1.0.0' })).toBeDefined();
    expect(
      IssuePassesResponseSchema.parse({
        passes: [{ serialNumber: UUID, sessionCode: 'DAT302', platforms: ['apple', 'google'] }],
      }),
    ).toBeDefined();
    expect(UpdatePassResponseSchema.parse({ serialNumber: UUID, version: 2 })).toBeDefined();
    expect(VoidPassResponseSchema.parse({ serialNumber: UUID, status: 'voided' })).toBeDefined();
    expect(
      CreateHandoffResponseSchema.parse({
        handoffId: 'x',
        boardUrl: 'https://x.test/board#h=x',
        expiresAt: '2026-12-02T10:15:00.000Z',
      }),
    ).toBeDefined();
    expect(ForgetMeResponseSchema.parse({ voided: 1, deleted: 3 })).toBeDefined();
    expect(SerialNumbersSchema.parse({ serialNumbers: [UUID], lastUpdated: '1' })).toBeDefined();
    for (const google of [null, { saveUrl: 'https://pay.google.com/gp/v/save/x' }]) {
      expect(
        HandoffViewSchema.parse({
          expiresAt: '2026-12-02T10:15:00Z',
          sessions: [
            {
              serialNumber: UUID,
              sessionCode: 'DAT302',
              title: 'T',
              startsAt: '2026-12-02T10:00:00-08:00',
              venue: 'The Venetian',
              applePath: `/api/v1/handoffs/x/apple/pass/${UUID}`,
              googleSaveUrl: google === null ? null : 'https://pay.google.com/gp/v/save/y',
            },
          ],
          apple: { bundlePaths: ['/api/v1/handoffs/x/apple/0'] },
          google,
          calendarPath: null,
        }),
      ).toBeDefined();
    }
  });

  test('a hand-off view has one top link only and every session names its two fields', () => {
    const session = {
      serialNumber: UUID,
      sessionCode: 'DAT302',
      title: 'T',
      startsAt: '2026-12-02T10:00:00-08:00',
      venue: null,
      applePath: null,
      googleSaveUrl: null,
    };
    const view = (google: unknown, sessions: unknown[] = []) =>
      HandoffViewSchema.safeParse({
        expiresAt: '2026-12-02T10:15:00Z',
        sessions,
        apple: { bundlePaths: [] },
        google,
        calendarPath: null,
      }).success;
    expect(view({ saveUrl: 'https://pay.google.com/gp/v/save/x' }, [session])).toBe(true);
    expect(view({ saveUrl: 'https://pay.google.com/gp/v/save/x', saveUrls: [] })).toBe(false);
    expect(view({ saveUrls: ['https://pay.google.com/gp/v/save/x'] })).toBe(false);
    for (const key of ['venue', 'applePath', 'googleSaveUrl']) {
      const missing: Record<string, unknown> = { ...session };
      delete missing[key];
      expect(view(null, [missing])).toBe(false);
      expect(view(null, [{ ...session, [key]: 5 }])).toBe(false);
    }
  });

  test('extra keys, wrong values and missing keys are refused', () => {
    expect(HealthSchema.safeParse({ status: 'ok', version: '1', extra: 1 }).success).toBe(false);
    expect(VoidPassResponseSchema.safeParse({ serialNumber: UUID, status: 'active' }).success).toBe(
      false,
    );
    expect(UpdatePassResponseSchema.safeParse({ serialNumber: 'nope', version: 1 }).success).toBe(
      false,
    );
    expect(ForgetMeResponseSchema.safeParse({ voided: 1 }).success).toBe(false);
    expect(
      CreateHandoffResponseSchema.safeParse({ handoffId: 'x', boardUrl: 'y', expiresAt: 'soon' })
        .success,
    ).toBe(false);
  });
});
