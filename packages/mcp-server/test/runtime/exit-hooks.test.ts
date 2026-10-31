import { describe, expect, test } from 'vitest';
import { onProcessEnd, processUid, STOP_SIGNALS } from '../../src/runtime/exit-hooks.js';
import type { ExitProcess } from '../../src/runtime/exit-hooks.js';

// Feature: compass-power, task 48 (security review M2): the QR page is removed on exit and on the
// stop signals, and the signal still stops the process.

/** A process stand-in: once listeners, listener counts and the kills it was asked for. */
function fakeProcess(otherListeners: Record<string, number> = {}) {
  const listeners = new Map<string, (() => void)[]>();
  const kills: { pid: number; signal: string }[] = [];
  const proc: ExitProcess = {
    pid: 4242,
    once: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    listenerCount: (event) => (otherListeners[event] ?? 0) + (listeners.get(event)?.length ?? 0),
    kill: (pid, signal) => {
      kills.push({ pid, signal });
    },
  };
  /** Emits like Node: a once listener is removed before it runs. */
  const emit = (event: string): void => {
    const now = listeners.get(event) ?? [];
    listeners.delete(event);
    for (const listener of now) listener();
  };
  return { proc, emit, kills, listeners };
}

describe('onProcessEnd', () => {
  test('registers for exit and every stop signal', () => {
    const { proc, listeners } = fakeProcess();
    onProcessEnd(() => undefined, proc);
    expect([...listeners.keys()].sort()).toEqual(['exit', ...STOP_SIGNALS].sort());
  });

  test('a stop signal runs the clean-up once and raises the signal again', () => {
    for (const signal of STOP_SIGNALS) {
      const { proc, emit, kills } = fakeProcess();
      let runs = 0;
      onProcessEnd(() => {
        runs += 1;
      }, proc);
      emit(signal);
      expect(runs).toBe(1);
      expect(kills).toEqual([{ pid: 4242, signal }]);
      // The exit that follows does not run it again.
      emit('exit');
      expect(runs).toBe(1);
    }
  });

  test('a plain exit runs it once and kills nothing', () => {
    const { proc, emit, kills } = fakeProcess();
    let runs = 0;
    onProcessEnd(() => {
      runs += 1;
    }, proc);
    emit('exit');
    expect(runs).toBe(1);
    expect(kills).toEqual([]);
  });

  test('when another listener handles the signal, the signal is left to it', () => {
    const { proc, emit, kills } = fakeProcess({ SIGINT: 1 });
    let runs = 0;
    onProcessEnd(() => {
      runs += 1;
    }, proc);
    emit('SIGINT');
    expect(runs).toBe(1);
    expect(kills).toEqual([]);
  });

  test('the real process is the default', () => {
    const before = process.listenerCount('exit');
    const signals = STOP_SIGNALS.map((signal) => process.listenerCount(signal));
    let ran = false;
    onProcessEnd(() => {
      ran = true;
    });
    expect(process.listenerCount('exit')).toBe(before + 1);
    // Remove what was added, so the test leaves the worker as it found it.
    for (const [index, signal] of STOP_SIGNALS.entries()) {
      const added = process.listeners(signal).slice(signals[index]);
      for (const listener of added) process.removeListener(signal, listener);
    }
    const exitAdded = process.listeners('exit').slice(before);
    for (const listener of exitAdded) {
      process.removeListener('exit', listener);
      (listener as () => void)();
    }
    expect(ran).toBe(true);
  });
});

describe('processUid', () => {
  test('is the POSIX user id, or undefined where there is no getuid', () => {
    expect(processUid({ getuid: () => 501 })).toBe(501);
    expect(processUid({})).toBeUndefined();
    expect(processUid()).toBe(process.getuid?.());
  });
});
