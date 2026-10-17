import { describe, expect, test } from 'vitest';
import { watchVisibility } from '../../src/lib/board/visibility';

function fakes(state: string) {
  const doc = new Map<string, (() => void)[]>();
  const win = new Map<string, (() => void)[]>();
  const add = (map: Map<string, (() => void)[]>) => (type: string, listener: () => void) => {
    map.set(type, [...(map.get(type) ?? []), listener]);
  };
  const remove = (map: Map<string, (() => void)[]>) => (type: string, listener: () => void) => {
    map.set(
      type,
      (map.get(type) ?? []).filter((l) => l !== listener),
    );
  };
  const document = {
    visibilityState: state,
    addEventListener: add(doc),
    removeEventListener: remove(doc),
  };
  const window = { addEventListener: add(win), removeEventListener: remove(win) };
  const fire = (map: Map<string, (() => void)[]>, type: string) => {
    for (const listener of map.get(type) ?? []) {
      listener();
    }
  };
  return { document, window, doc, win, fire };
}

describe('watchVisibility', () => {
  test('calls the listener on pageshow and on becoming visible, but not on becoming hidden', () => {
    const f = fakes('hidden');
    let calls = 0;
    watchVisibility(f.document, f.window, () => {
      calls += 1;
    });
    f.fire(f.doc, 'visibilitychange');
    expect(calls).toBe(0);
    f.document.visibilityState = 'visible';
    f.fire(f.doc, 'visibilitychange');
    expect(calls).toBe(1);
    f.fire(f.win, 'pageshow');
    expect(calls).toBe(2);
  });

  test('the stop function removes both listeners', () => {
    const f = fakes('visible');
    let calls = 0;
    const stop = watchVisibility(f.document, f.window, () => {
      calls += 1;
    });
    stop();
    f.fire(f.doc, 'visibilitychange');
    f.fire(f.win, 'pageshow');
    expect(calls).toBe(0);
  });
});
