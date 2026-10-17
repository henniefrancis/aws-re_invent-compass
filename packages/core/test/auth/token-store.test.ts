import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import fc from 'fast-check';

// The real keyring module must never be exercised by tests. It is replaced for the
// whole file by an in-memory fake, so even the default-keyring path stays off the OS
// keychain.
const mockStore = vi.hoisted(() => ({ secrets: new Map<string, number[]>() }));
vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    constructor(
      private readonly service: string,
      private readonly account: string,
    ) {}
    setSecret(secret: Uint8Array): void {
      mockStore.secrets.set(`${this.service}/${this.account}`, [...secret]);
    }
    getSecret(): number[] | null {
      return mockStore.secrets.get(`${this.service}/${this.account}`) ?? null;
    }
    deleteCredential(): boolean {
      return mockStore.secrets.delete(`${this.service}/${this.account}`);
    }
  },
}));

import {
  KEYCHAIN_ACCOUNTS,
  KEYCHAIN_SERVICE,
  createTokenStore,
  type KeyringEntryLike,
  type KeyringLike,
  type TokenSet,
} from '../../src/auth/token-store.js';

// Tests for the token store (events-client, S1, tasks 10.1 to 10.3). A recording fake
// keyring stands in for the OS keychain: it can be made to throw on any call, and it
// records how every Entry was constructed. Nothing here reaches the real keychain.

interface FakeKeyring extends KeyringLike {
  secrets: Map<string, number[]>;
  constructed: { service: string; account: string; options: unknown }[];
  calls: string[];
  failOn: Set<string>;
}

/** A fake keyring. failOn holds "<op>:<account>" or "<op>" keys that should throw. */
function fakeKeyring(options: { constructorThrows?: boolean } = {}): FakeKeyring {
  const fake: FakeKeyring = {
    secrets: new Map(),
    constructed: [],
    calls: [],
    failOn: new Set(),
    Entry: class implements KeyringEntryLike {
      private readonly account: string;
      constructor(service: string, account: string, opts?: unknown) {
        if (options.constructorThrows === true) {
          throw new Error('no secret service');
        }
        this.account = account;
        fake.constructed.push({ service, account, options: opts });
      }
      private guard(op: string): void {
        fake.calls.push(`${op}:${this.account}`);
        if (fake.failOn.has(op) || fake.failOn.has(`${op}:${this.account}`)) {
          throw new Error(`${op} failed`);
        }
      }
      setSecret(secret: Uint8Array): void {
        this.guard('set');
        fake.secrets.set(this.account, [...secret]);
      }
      getSecret(): number[] | null {
        this.guard('get');
        return fake.secrets.get(this.account) ?? null;
      }
      deleteCredential(): boolean {
        this.guard('delete');
        return fake.secrets.delete(this.account);
      }
    },
  };
  return fake;
}

const tokenArb = fc.string({ minLength: 1, maxLength: 40 });
const tokenSetArb: fc.Arbitrary<TokenSet> = fc.record({
  accessToken: tokenArb,
  refreshToken: tokenArb,
  idToken: tokenArb,
  accessTokenExpiresAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
});

const sample: TokenSet = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  idToken: 'id-1',
  accessTokenExpiresAt: 1234,
};

describe('Feature: events-client, Property 5: Token storage round-trips through the keychain', () => {
  // Validates: Requirements 2.1, 3.3
  test('for any token set, save then load returns it, held in the keychain as UTF-8 bytes', () => {
    fc.assert(
      fc.property(tokenSetArb, (tokens) => {
        const keyring = fakeKeyring();
        const store = createTokenStore(keyring);
        expect(store.kind).toBe('keychain');
        expect(store.save(tokens)).toBe('keychain');
        expect(store.load()).toEqual(tokens);
        expect(Buffer.from(keyring.secrets.get('access') ?? []).toString('utf8')).toBe(
          `${String(tokens.accessTokenExpiresAt)}:${tokens.accessToken}`,
        );
        expect(Buffer.from(keyring.secrets.get('refresh') ?? []).toString('utf8')).toBe(
          tokens.refreshToken,
        );
        expect(Buffer.from(keyring.secrets.get('id') ?? []).toString('utf8')).toBe(tokens.idToken);
      }),
      { numRuns: 100 },
    );
  });

  test('every entry uses the reinvent-compass service, its account and the secret-service store', () => {
    const keyring = fakeKeyring();
    createTokenStore(keyring);
    expect(keyring.constructed).toEqual(
      ['access', 'refresh', 'id'].map((account) => ({
        service: KEYCHAIN_SERVICE,
        account,
        options: { linux: { store: 'secret-service' } },
      })),
    );
    expect(KEYCHAIN_SERVICE).toBe('reinvent-compass');
    expect(KEYCHAIN_ACCOUNTS).toEqual({ access: 'access', refresh: 'refresh', id: 'id' });
  });

  test('a refreshed save replaces the stored tokens', () => {
    const store = createTokenStore(fakeKeyring());
    store.save(sample);
    store.save({ ...sample, accessToken: 'access-2', idToken: 'id-2', accessTokenExpiresAt: 99 });
    expect(store.load()).toEqual({
      accessToken: 'access-2',
      refreshToken: 'refresh-1',
      idToken: 'id-2',
      accessTokenExpiresAt: 99,
    });
  });

  test('an empty keychain loads as not signed in, as does a partly filled one', () => {
    const keyring = fakeKeyring();
    const store = createTokenStore(keyring);
    expect(store.load()).toBeUndefined();
    for (const missing of ['access', 'refresh', 'id']) {
      store.save(sample);
      keyring.secrets.delete(missing);
      expect(store.load()).toBeUndefined();
    }
  });

  test('the expiry is stored with the access token and survives a restart (QA L9)', () => {
    const keyring = fakeKeyring();
    createTokenStore(keyring).save(sample);
    expect(createTokenStore(keyring).load()).toEqual(sample);
  });

  test('an access value written by an earlier version (no expiry prefix) reads as a bare token with expiry 0', () => {
    const keyring = fakeKeyring();
    const store = createTokenStore(keyring);
    store.save(sample);
    keyring.secrets.set('access', [...Buffer.from('eyJhbGciOiJub25lIn0.payload.sig', 'utf8')]);
    expect(store.load()).toEqual({
      ...sample,
      accessToken: 'eyJhbGciOiJub25lIn0.payload.sig',
      accessTokenExpiresAt: 0,
    });
    // A colon with a non-numeric prefix, or a leading colon, is also a bare token.
    for (const bare of ['abc:def', ':leading', '12ab:tail']) {
      keyring.secrets.set('access', [...Buffer.from(bare, 'utf8')]);
      expect(store.load()?.accessToken).toBe(bare);
    }
  });

  test('clear removes every token from the keychain and from memory', () => {
    const keyring = fakeKeyring();
    const store = createTokenStore(keyring);
    store.save(sample);
    store.clear();
    expect(store.load()).toBeUndefined();
    expect(keyring.secrets.size).toBe(0);
  });

  test('the default keyring is the (mocked) module, with no real keychain involved', () => {
    const store = createTokenStore();
    expect(store.kind).toBe('keychain');
    expect(store.save(sample)).toBe('keychain');
    expect(store.load()).toEqual(sample);
    expect(mockStore.secrets.size).toBe(3);
    store.clear();
    expect(mockStore.secrets.size).toBe(0);
  });
});

describe('Feature: events-client, Property 6: Keychain absence or failure falls back to memory and never writes a file', () => {
  // Validates: Requirements 2.2, 2.4, 2.6
  const tokenStoreSource = readFileSync(
    fileURLToPath(new URL('../../src/auth/token-store.ts', import.meta.url)),
    'utf8',
  );

  function cwdListing(): string[] {
    return readdirSync(process.cwd()).sort();
  }

  test('when the entries cannot be constructed the store is memory-only and round-trips', () => {
    fc.assert(
      fc.property(tokenSetArb, (tokens) => {
        const before = cwdListing();
        const store = createTokenStore(fakeKeyring({ constructorThrows: true }));
        expect(store.kind).toBe('memory');
        expect(store.load()).toBeUndefined();
        expect(store.save(tokens)).toBe('memory');
        expect(store.load()).toEqual(tokens);
        store.clear();
        expect(store.load()).toBeUndefined();
        expect(cwdListing()).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  test('a throwing keychain write falls back to memory, deletes every entry and reports no token', () => {
    fc.assert(
      fc.property(
        tokenSetArb,
        fc.constantFrom('set', 'set:access', 'set:refresh', 'set:id'),
        (tokens, failKey) => {
          const keyring = fakeKeyring();
          keyring.failOn.add(failKey);
          const store = createTokenStore(keyring);
          const result = store.save(tokens);
          expect(result).toBe('memory');
          expect(store.kind).toBe('memory');
          expect(store.load()).toEqual(tokens);
          expect(keyring.secrets.size).toBe(0);
          expect(keyring.calls.filter((c) => c.startsWith('delete:'))).toEqual([
            'delete:access',
            'delete:refresh',
            'delete:id',
          ]);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('later saves after a fallback stay in memory without touching the keychain again', () => {
    const keyring = fakeKeyring();
    keyring.failOn.add('set');
    const store = createTokenStore(keyring);
    store.save(sample);
    keyring.calls.length = 0;
    expect(store.save({ ...sample, accessToken: 'later' })).toBe('memory');
    expect(store.load()?.accessToken).toBe('later');
    expect(keyring.calls).toEqual([]);
  });

  test('a throwing keychain read falls back to memory and removes the entries', () => {
    const keyring = fakeKeyring();
    const store = createTokenStore(keyring);
    store.save(sample);
    keyring.failOn.add('get:refresh');
    expect(store.load()).toBeUndefined();
    expect(store.kind).toBe('memory');
    expect(keyring.secrets.size).toBe(0);
    expect(store.save(sample)).toBe('memory');
    expect(store.load()).toEqual(sample);
  });

  test('clear empties memory even when every delete throws', () => {
    const keyring = fakeKeyring();
    keyring.failOn.add('set');
    const store = createTokenStore(keyring);
    store.save(sample);
    keyring.failOn.add('delete');
    expect(() => {
      store.clear();
    }).not.toThrow();
    expect(store.load()).toBeUndefined();
    expect(keyring.calls.filter((c) => c.startsWith('delete:')).length).toBeGreaterThanOrEqual(6);
  });

  test('the token store source imports no file, path or process API and calls none', () => {
    expect(tokenStoreSource).not.toMatch(
      /node:fs|from 'fs'|node:path|node:os|writeFile|appendFile|createWriteStream/,
    );
  });
});

describe('events-client, M2: the store generation', () => {
  test('sign-in saves, clears and invalidate each start a new generation', () => {
    const store = createTokenStore(fakeKeyring());
    const g0 = store.generation;
    store.save(sample);
    expect(store.generation).toBe(g0 + 1);
    store.invalidate();
    expect(store.generation).toBe(g0 + 2);
    store.clear();
    expect(store.generation).toBe(g0 + 3);
  });

  test('replaceIfCurrent writes only for the current generation and keeps it', () => {
    const store = createTokenStore(fakeKeyring());
    store.save(sample);
    const g = store.generation;
    const refreshed = { ...sample, accessToken: 'refreshed-access' };
    expect(store.replaceIfCurrent(g, refreshed)).toBe('keychain');
    expect(store.generation).toBe(g);
    expect(store.load()?.accessToken).toBe('refreshed-access');
    store.invalidate();
    expect(store.replaceIfCurrent(g, { ...sample, accessToken: 'late' })).toBeUndefined();
    expect(store.load()?.accessToken).toBe('refreshed-access');
  });

  test('clearIfCurrent clears only for the current generation', () => {
    const store = createTokenStore(fakeKeyring());
    store.save(sample);
    const stale = store.generation;
    store.save({ ...sample, accessToken: 'newer' });
    expect(store.clearIfCurrent(stale)).toBe(false);
    expect(store.load()?.accessToken).toBe('newer');
    expect(store.clearIfCurrent(store.generation)).toBe(true);
    expect(store.load()).toBeUndefined();
  });
});
