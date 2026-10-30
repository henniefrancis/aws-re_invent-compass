import { describe, expect, test } from 'vitest';
import {
  CompassApiResponseSchemas,
  CreateHandoffResponseSchema,
  ForgetMeResponseSchema,
  HandoffViewSchema,
  HealthSchema,
  IssuePassesResponseSchema,
  SerialNumbersSchema,
  UpdatePassResponseSchema,
  VoidPassResponseSchema,
} from '../src/index.js';

// CTO M2: the Compass API response schemas live here once; pass-service and core import them.
const SERIAL = '11111111-1111-4111-8111-111111111111';
const WHEN = '2026-12-02T10:00:00-08:00';

const valid: Record<keyof typeof CompassApiResponseSchemas, unknown> = {
  HealthSchema: { status: 'ok', version: '1' },
  IssuePassesResponseSchema: {
    passes: [{ serialNumber: SERIAL, sessionCode: 'ABC101', platforms: ['apple', 'google'] }],
  },
  UpdatePassResponseSchema: { serialNumber: SERIAL, version: 2 },
  VoidPassResponseSchema: { serialNumber: SERIAL, status: 'voided' },
  CreateHandoffResponseSchema: { handoffId: 'abc', boardUrl: 'https://x.test/b', expiresAt: WHEN },
  HandoffViewSchema: {
    expiresAt: WHEN,
    sessions: [
      {
        serialNumber: SERIAL,
        sessionCode: 'ABC101',
        title: 'T',
        startsAt: WHEN,
        venue: null,
        applePath: null,
        googleSaveUrl: null,
      },
    ],
    apple: { bundlePaths: ['/a'] },
    google: null,
    calendarPath: null,
  },
  ForgetMeResponseSchema: { voided: 1, deleted: 2 },
  SerialNumbersSchema: { serialNumbers: [SERIAL], lastUpdated: '1' },
};

describe('Feature: foundation-contracts, Compass API response schemas', () => {
  test('the named exports are the members of the collection', () => {
    expect(CompassApiResponseSchemas).toEqual({
      HealthSchema,
      IssuePassesResponseSchema,
      UpdatePassResponseSchema,
      VoidPassResponseSchema,
      CreateHandoffResponseSchema,
      HandoffViewSchema,
      ForgetMeResponseSchema,
      SerialNumbersSchema,
    });
  });

  test.each(Object.entries(CompassApiResponseSchemas))(
    '%s accepts its body and rejects an extra field',
    (name, schema) => {
      const body = valid[name as keyof typeof valid];
      expect(schema.safeParse(body).success).toBe(true);
      expect(schema.safeParse({ ...(body as object), extra: 1 }).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(false);
    },
  );

  test('a bad date, uuid or status is refused', () => {
    expect(
      CreateHandoffResponseSchema.safeParse({
        ...(valid.CreateHandoffResponseSchema as object),
        expiresAt: 'soon',
      }).success,
    ).toBe(false);
    expect(UpdatePassResponseSchema.safeParse({ serialNumber: 'x', version: 1 }).success).toBe(
      false,
    );
    expect(
      VoidPassResponseSchema.safeParse({ serialNumber: SERIAL, status: 'active' }).success,
    ).toBe(false);
  });
});
