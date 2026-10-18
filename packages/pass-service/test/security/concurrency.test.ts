import { describe, expect, test, vi } from 'vitest';
import { createApiFixture, type ApiFixture } from '../helpers/api-fixture.js';
import { samplePassFields } from '../helpers/pass-fields.js';
import { makePassRecord, serialOf } from '../helpers/pass-record.js';

vi.setConfig({ testTimeout: 120_000 });

const SUB = '8'.repeat(64);
const TYPE = 'pass.test.compass';
const REG =
  '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}';

// Code review M2 and N7: the two caps (80 active passes, 10 registrations per pass) must hold
// when requests run at the same time. Each request is told no, or all of its work is undone.

function activePassItems(fixture: ApiFixture) {
  return fixture.table
    .snapshot()
    .filter((item) => item.pk.startsWith('PASS#') && item.status === 'active');
}

describe('Feature: pass-service, concurrent caps', () => {
  test('concurrent issue requests cannot together pass the 80 active pass cap', async () => {
    const fixture = createApiFixture();
    for (let i = 0; i < 60; i += 1) {
      await fixture.deps.passes.create(makePassRecord(SUB, serialOf(i + 1)));
    }
    const replies = await Promise.all(
      Array.from({ length: 5 }, (_, request) =>
        fixture.call({
          method: 'POST',
          resource: '/api/v1/passes',
          token: SUB,
          body: {
            platforms: ['apple'],
            passes: Array.from({ length: 5 }, (_, i) =>
              samplePassFields({ sessionCode: `CAP${request}${i}` }),
            ),
          },
        }),
      ),
    );
    const statuses = replies.map((reply) => reply.result.statusCode);
    expect(statuses.every((status) => status === 201 || status === 429)).toBe(true);
    expect(activePassItems(fixture).length).toBeLessThanOrEqual(80);
    expect(activePassItems(fixture).length).toBe(60 + 5 * statuses.filter((s) => s === 201).length);
    expect(await fixture.deps.passes.countActive(SUB, fixture.clock.now())).toBe(
      activePassItems(fixture).length,
    );
    for (const reply of replies.filter((r) => r.result.statusCode === 429)) {
      expect(reply.json).toMatchObject({ code: 'active_pass_limit' });
      expect(reply.result.headers['retry-after']).toBeUndefined();
    }
  });

  test('concurrent registrations cannot together pass the cap of ten devices per pass', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    const register = (device: string) =>
      fixture.callPasskit({
        method: 'POST',
        resource: REG,
        path: {
          deviceLibraryIdentifier: device,
          passTypeIdentifier: TYPE,
          serialNumber: serial,
        },
        headers: { authorization: `ApplePass ${token}` },
        body: { pushToken: 'aabbccdd' },
      });
    for (let i = 0; i < 9; i += 1) {
      expect(
        (await register(`device-library-${String(i).padStart(4, '0')}`)).result.statusCode,
      ).toBe(201);
    }
    const replies = await Promise.all(
      Array.from({ length: 5 }, (_, i) => register(`device-library-new-${i}`)),
    );
    expect(
      replies.every((reply) => reply.result.statusCode === 200 || reply.result.statusCode === 201),
    ).toBe(true);
    const stored = fixture.table.snapshot().filter((item) => item.pk.startsWith('DEV#'));
    expect(stored.length).toBeLessThanOrEqual(10);
    const live = await fixture.deps.registrations.listByPass(serial, fixture.clock.now());
    expect(live.length).toBe(stored.length);
    expect(fixture.table.snapshot().filter((item) => item.pk.startsWith('PASSREG#'))).toHaveLength(
      stored.length,
    );
  });
});
