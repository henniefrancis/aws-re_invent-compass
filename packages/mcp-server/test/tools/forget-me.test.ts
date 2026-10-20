import { describe, expect, test } from 'vitest';
import { forgetMe } from '../../src/tools/forget-me.js';
import type { ToolContext } from '../../src/server/types.js';
import { connect, textOf } from '../support/connect.js';
import { contextFor } from '../support/context.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

function setup(elicit?: ToolContext['elicit']) {
  const fake = createFakeRuntime();
  const ctx = contextFor(fake, elicit === undefined ? {} : { elicit });
  ctx.state.swaps.propose({ originalId: TRIPLE.a, repeatId: TRIPLE.aRepeat, blockedId: TRIPLE.b });
  ctx.state.lastScan = {
    result: {
      services: [],
      unmappedCount: 0,
      filesRead: 0,
      skipped: {
        excludedDirectory: 0,
        gitignored: 0,
        tooLarge: 0,
        binary: 0,
        symlink: 0,
        unsupportedType: 0,
      },
      truncated: false,
      pythonAnalysed: false,
      technologies: [],
    },
    taxonomy: [],
    root: '/scanned',
  };
  return { fake, ctx };
}

describe('forget_me', () => {
  test('on success it deletes the snapshot and clears the scan and swaps, without claiming phone deletion', async () => {
    const { fake, ctx } = setup();
    const outcome = await forgetMe({ confirm: true }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ forgotten: true });
    expect(fake.snapshot.removed).toBe(1);
    expect(ctx.state.lastScan).toBeUndefined();
    expect(ctx.state.swaps.forOriginal(TRIPLE.a)).toBeUndefined();
    const text = outcome.ok ? outcome.text : '';
    expect(text).toContain('voided');
    expect(text).toContain('stay on the phone until you remove them yourself');
    expect(text).not.toMatch(/deleted from (your|the) phone/i);
  });

  test('on failure nothing local is touched and the text says nothing was deleted', async () => {
    const { fake, ctx } = setup();
    fake.passes.forgetResult = { ok: false, summary: 'The service could not confirm it.' };
    const outcome = await forgetMe({ confirm: true }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ forgotten: false });
    expect(outcome.ok && outcome.text).toContain('Nothing was deleted on this computer.');
    expect(fake.snapshot.removed).toBe(0);
    expect(ctx.state.lastScan).toBeDefined();
    expect(ctx.state.swaps.forOriginal(TRIPLE.a)).toBeDefined();
  });

  test('a decline or cancel deletes nothing and a signed-out attendee is refused', async () => {
    for (const answer of ['decline', 'cancel'] as const) {
      const { fake, ctx } = setup(() => Promise.resolve(answer));
      const outcome = await forgetMe({ confirm: true }, ctx);
      expect(outcome.ok && outcome.text).toContain('did not confirm');
      expect(fake.passes.writeCalls).toEqual([]);
    }
    const { fake, ctx } = setup();
    fake.events.signedIn = false;
    await expect(forgetMe({ confirm: true }, ctx)).rejects.toMatchObject({ code: 'NotSignedIn' });
  });

  test('the contract only accepts confirm true', async () => {
    const { fake } = setup();
    const connection = await connect(fake.runtime);
    const result = await connection.call('forget_me', { confirm: false });
    expect(result.isError).toBe(true);
    expect(fake.passes.writeCalls).toEqual([]);
    const ok = await connection.call('forget_me', { confirm: true });
    expect(textOf(ok)).toContain('local Compass data was deleted');
    await connection.close();
  });
});
