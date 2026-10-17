import { describe, expect, test } from 'vitest';
import { registerStoreSecrets } from '../../src/auth/secret-registering-store.js';
import { capturingLogger, fakeStore, heldTokens } from './auth-harness.js';

// Tests for the secret-registering store wrapper (events-client, S1, finding M4).

function leaks(lines: string[], tokens: ReturnType<typeof heldTokens>): boolean {
  return [tokens.accessToken, tokens.refreshToken, tokens.idToken].some((t) =>
    lines.join('\n').includes(t),
  );
}

describe('events-client, M4: tokens are registered when the store loads or saves them', () => {
  test('tokens already in the store (for example from the keychain) are scrubbed after load()', () => {
    const tokens = heldTokens();
    const { logger, lines } = capturingLogger();
    const store = registerStoreSecrets(fakeStore(tokens), logger);
    logger.info(`before load ${tokens.refreshToken}`);
    expect(store.load()).toEqual(tokens);
    logger.info(`after load ${tokens.refreshToken} ${encodeURIComponent(tokens.idToken)}`);
    expect(lines[0]).toContain(tokens.refreshToken);
    expect(lines[1]).not.toContain(tokens.refreshToken);
    expect(lines[1]).not.toContain(tokens.idToken);
  });

  test('load() of an empty store registers nothing and returns undefined', () => {
    const { logger } = capturingLogger();
    expect(registerStoreSecrets(fakeStore(), logger).load()).toBeUndefined();
  });

  test('save() and replaceIfCurrent() register before writing', () => {
    const { logger, lines } = capturingLogger();
    const store = registerStoreSecrets(fakeStore(), logger);
    const first = heldTokens({
      accessToken: 'first-access-value',
      refreshToken: 'first-refresh-value',
      idToken: 'first-id-value',
    });
    expect(store.save(first)).toBe('keychain');
    const second = heldTokens({
      accessToken: 'second-access-value',
      refreshToken: 'second-refresh-value',
      idToken: 'second-id-value',
    });
    expect(store.replaceIfCurrent(store.generation, second)).toBe('keychain');
    expect(store.replaceIfCurrent(store.generation - 1, second)).toBeUndefined();
    logger.info(`${first.accessToken} ${second.accessToken}`);
    expect(leaks(lines, first)).toBe(false);
    expect(leaks(lines, second)).toBe(false);
    expect(store.kind).toBe('keychain');
  });

  test('clear() removes the needles, and clearIfCurrent() does so only when it clears', () => {
    const tokens = heldTokens();
    const first = capturingLogger();
    const store = registerStoreSecrets(fakeStore(tokens), first.logger);
    store.load();
    store.clear();
    first.logger.info(`after clear ${tokens.refreshToken}`);
    expect(first.lines[0]).toContain(tokens.refreshToken);

    const other = capturingLogger();
    const wrapped = registerStoreSecrets(fakeStore(tokens), other.logger);
    wrapped.load();
    const generation = wrapped.generation;
    wrapped.invalidate();
    expect(wrapped.clearIfCurrent(generation)).toBe(false);
    other.logger.info(`still ${tokens.refreshToken}`);
    expect(other.lines[0]).not.toContain(tokens.refreshToken);
    expect(wrapped.clearIfCurrent(wrapped.generation)).toBe(true);
    other.logger.info(`gone ${tokens.refreshToken}`);
    expect(other.lines[1]).toContain(tokens.refreshToken);
  });
});
