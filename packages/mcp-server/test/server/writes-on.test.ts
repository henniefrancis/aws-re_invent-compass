import { describe, expect, test } from 'vitest';
import { WRITES_ON_LINE } from '../../src/server/create-server.js';
import { connect, textOf } from '../support/connect.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';

// Compass-power task 40 (CTO review M1): when writes are on in live mode, the person in the
// chat sees it at the top of every schedule reply, show_schedule and sign_in.

async function call(
  options: { mode: 'live' | 'simulated'; readOnly?: boolean },
  tool: 'show_schedule' | 'find_sessions',
) {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView(), ...options });
  const connection = await connect(fake.runtime);
  const result = await connection.call(tool, tool === 'find_sessions' ? { query: 'ai' } : {});
  await connection.close();
  return textOf(result);
}

describe('the writes-on line', () => {
  test('live mode with writes on shows it first', async () => {
    expect((await call({ mode: 'live' }, 'show_schedule')).startsWith(WRITES_ON_LINE)).toBe(true);
  });

  test('read-only live mode, simulated mode and read tools do not show it', async () => {
    expect(await call({ mode: 'live', readOnly: true }, 'show_schedule')).not.toContain(
      WRITES_ON_LINE,
    );
    expect(await call({ mode: 'simulated' }, 'show_schedule')).not.toContain(WRITES_ON_LINE);
    expect(await call({ mode: 'live' }, 'find_sessions')).not.toContain(WRITES_ON_LINE);
  });
});
