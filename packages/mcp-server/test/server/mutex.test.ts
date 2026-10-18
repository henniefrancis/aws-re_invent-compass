import { describe, expect, test } from 'vitest';
import { createMutex } from '../../src/server/mutex.js';
import { connect } from '../support/connect.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('createMutex', () => {
  test('runs tasks one at a time in arrival order and survives a failing task', async () => {
    const mutex = createMutex();
    const log: string[] = [];
    const task =
      (name: string, ms: number, fail = false) =>
      () =>
        (async () => {
          log.push(`start ${name}`);
          await pause(ms);
          log.push(`end ${name}`);
          if (fail) {
            throw new Error(name);
          }
          return name;
        })();
    const results = await Promise.allSettled([
      mutex.run(task('a', 30)),
      mutex.run(task('b', 5, true)),
      mutex.run(task('c', 1)),
    ]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});

describe('write tools are serialised (QA M2)', () => {
  test('two reserves for the same session sent together send one write, because the second re-reads the schedule', async () => {
    const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
    const realReserve = fake.events.reserve.bind(fake.events);
    const realSchedule = fake.events.getSchedule.bind(fake.events);
    fake.events.getSchedule = async () => {
      await pause(10);
      return realSchedule();
    };
    fake.events.reserve = async (ids) => {
      await pause(10);
      return realReserve(ids);
    };
    const connection = await connect(fake.runtime);
    const [first, second] = await Promise.all([
      connection.call('reserve_with_guardrails', { sessionIds: [TRIPLE.a] }),
      connection.call('reserve_with_guardrails', { sessionIds: [TRIPLE.a] }),
    ]);
    expect(fake.events.callsTo('reserve')).toHaveLength(1);
    expect(
      [first, second].filter((r) => r.structuredContent && 'result' in r.structuredContent),
    ).toHaveLength(1);
    await connection.close();
  });

  test('read tools are not held up by a slow write', async () => {
    const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realReserve = fake.events.reserve.bind(fake.events);
    fake.events.reserve = async (ids) => {
      await gate;
      return realReserve(ids);
    };
    const connection = await connect(fake.runtime);
    const write = connection.call('reserve_with_guardrails', { sessionIds: [TRIPLE.a] });
    await pause(20);
    const read = await connection.call('find_sessions', { query: 'BWP213' });
    expect(read.isError).not.toBe(true);
    release();
    await write;
    await connection.close();
  });
});
