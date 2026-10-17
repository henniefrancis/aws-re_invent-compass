import { describe, expect, test } from 'vitest';
import { createHarness, response } from './operation-harness.js';
import { cancelReservation } from '../../src/api/cancel-reservation.js';
import { disassociateFavorite } from '../../src/api/disassociate-favorite.js';
import { createPersonalTime } from '../../src/api/create-personal-time.js';
import { updatePersonalTime } from '../../src/api/update-personal-time.js';
import { deletePersonalTime } from '../../src/api/delete-personal-time.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ServerError,
  ValidationError,
} from '../../src/api/errors.js';
import type { PersonalTimeInput } from '@compass/contracts';

// Unit tests for the five no-body write operations (events-client, S1, task 8.4). A
// 204 with an empty body is success with no validation (Requirement 6.7); a body
// where none is expected is a ValidationError; each failure status maps to its typed
// error. Also asserts the request shape (method, path, body) for each operation.

const input: PersonalTimeInput = {
  startDateTime: '2026-12-01T12:00:00-08:00',
  endDateTime: '2026-12-01T13:00:00-08:00',
  title: 'Lunch',
  description: 'Layover for food and water',
};

describe('events-client, task 8.3: no-body operations succeed on 204', () => {
  test('cancelReservation sends a DELETE and resolves on 204', async () => {
    const h = createHarness({ responses: [response(204, undefined)] });
    await expect(cancelReservation(h.ctx, 'S1')).resolves.toBeUndefined();
    expect(h.sent[0]?.method).toBe('DELETE');
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/reservations/S1');
  });

  test('disassociateFavorite sends a DELETE and resolves on 204', async () => {
    const h = createHarness({ responses: [response(204, undefined)] });
    await expect(disassociateFavorite(h.ctx, 'S1')).resolves.toBeUndefined();
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/favorites/S1');
  });

  test('createPersonalTime sends a POST with the input body and resolves on 204', async () => {
    const h = createHarness({ responses: [response(204, undefined)] });
    await expect(createPersonalTime(h.ctx, input)).resolves.toBeUndefined();
    expect(h.sent[0]?.method).toBe('POST');
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/personal-time');
    expect(h.sent[0]?.body).toEqual(input);
  });

  test('updatePersonalTime sends a PUT with the id in the path and the input body', async () => {
    const h = createHarness({ responses: [response(204, undefined)] });
    await expect(updatePersonalTime(h.ctx, 'p1', input)).resolves.toBeUndefined();
    expect(h.sent[0]?.method).toBe('PUT');
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/personal-time/p1');
    expect(h.sent[0]?.body).toEqual(input);
  });

  test('deletePersonalTime sends a DELETE and resolves on 204', async () => {
    const h = createHarness({ responses: [response(204, undefined)] });
    await expect(deletePersonalTime(h.ctx, 'p1')).resolves.toBeUndefined();
    expect(h.sent[0]?.method).toBe('DELETE');
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/personal-time/p1');
  });

  test('a body present where none is expected is a ValidationError', async () => {
    const h = createHarness({ responses: [response(200, { unexpected: true })] });
    await expect(cancelReservation(h.ctx, 'S1')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('events-client, task 8.3: no-body operations map error statuses', () => {
  const cases: ReadonlyArray<{ status: number; error: new (...args: never[]) => Error }> = [
    { status: 400, error: BadRequestError },
    { status: 403, error: ForbiddenError },
    { status: 404, error: NotFoundError },
    { status: 409, error: ConflictError },
    { status: 502, error: ServerError },
  ];
  for (const { status, error } of cases) {
    test(`status ${String(status)} maps to its typed error`, async () => {
      const h = createHarness({ responses: [response(status, undefined)] });
      await expect(deletePersonalTime(h.ctx, 'p1')).rejects.toBeInstanceOf(error);
    });
  }
});
