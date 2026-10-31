import { describe, expect, test } from 'vitest';
import {
  ACCESS_TOKEN_URL,
  DEVICE_CODE_URL,
  DEVICE_GRANT_TYPE,
  SLOW_DOWN_SECONDS,
  pollDeviceToken,
  refreshGitHubToken,
  startDeviceFlow,
  waitForDeviceToken,
  type DevicePollResult,
} from '../../src/github/device-flow.js';
import {
  GITHUB_FAILURE_CODES,
  GitHubNetworkError,
  GitHubNotConnectedError,
  GitHubSignInError,
} from '../../src/github/errors.js';
import type { GitHubResponseLike } from '../../src/github/http.js';
import {
  SECRET_ACCESS,
  SECRET_DEVICE,
  SECRET_REFRESH,
  errorText,
  fakeFetch,
  jsonResponse,
} from './support.js';

const CLIENT_ID = 'Iv23liCLIENTID';

const deviceBody = {
  device_code: SECRET_DEVICE,
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

const tokenBody = {
  access_token: SECRET_ACCESS,
  expires_in: 28800,
  refresh_token: SECRET_REFRESH,
  refresh_token_expires_in: 15897600,
  scope: '',
  token_type: 'bearer',
};

function params(body: string | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

describe('startDeviceFlow', () => {
  test('posts the client ID as a form to the device code endpoint and returns the validated codes', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, deviceBody));
    const started = await startDeviceFlow({ clientId: CLIENT_ID, fetch });
    expect(started).toEqual({
      deviceCode: SECRET_DEVICE,
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe(DEVICE_CODE_URL);
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('error');
    expect(call.init.headers.accept).toBe('application/json');
    expect(call.init.headers['user-agent']).toBe('reinvent-compass');
    expect(Object.keys(call.init.headers).map((h) => h.toLowerCase())).not.toContain(
      'authorization',
    );
    expect(params(call.init.body)).toEqual({ client_id: CLIENT_ID });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  test('defaults the interval to 5 seconds when GitHub leaves it out', async () => {
    const rest: Record<string, unknown> = { ...deviceBody };
    delete rest.interval;
    const { fetch } = fakeFetch(() => jsonResponse(200, rest));
    expect((await startDeviceFlow({ clientId: CLIENT_ID, fetch })).interval).toBe(5);
  });

  test.each([...GITHUB_FAILURE_CODES])(
    'the documented error %s is a sign-in error with that reason',
    async (code) => {
      const { fetch } = fakeFetch(() =>
        jsonResponse(200, { error: code, error_description: SECRET_DEVICE }),
      );
      const error = await startDeviceFlow({ clientId: CLIENT_ID, fetch }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubSignInError);
      expect((error as GitHubSignInError).reason).toBe(code);
      expect(errorText(error)).not.toContain(SECRET_DEVICE);
    },
  );

  test('an undocumented code, a failing status and an unusable body have fixed reasons', async () => {
    const reasons = async (response: GitHubResponseLike): Promise<string> => {
      const { fetch } = fakeFetch(() => response);
      const error = await startDeviceFlow({ clientId: CLIENT_ID, fetch }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubSignInError);
      return (error as GitHubSignInError).reason;
    };
    expect(await reasons(jsonResponse(200, { error: 'brand_new_code' }))).toBe('unknown_error');
    expect(await reasons(jsonResponse(200, { error: 'Not A Code' }))).toBe('invalid_response');
    expect(await reasons(jsonResponse(500, 'oops'))).toBe('http_error');
    expect(await reasons(jsonResponse(200, 'not json'))).toBe('invalid_response');
    for (const verification_uri of [
      'https://evil.example/login/device',
      'http://github.com/login/device',
      'https://github.com:8443/login/device',
      'not a url',
    ]) {
      expect(await reasons(jsonResponse(200, { ...deviceBody, verification_uri }))).toBe(
        'invalid_response',
      );
    }
    expect(await reasons(jsonResponse(200, { ...deviceBody, user_code: '<script>' }))).toBe(
      'invalid_response',
    );
  });

  test('a network failure is a GitHubNetworkError with no cause', async () => {
    const fetch = () => Promise.reject(new Error(`boom ${SECRET_DEVICE}`));
    const error = await startDeviceFlow({ clientId: CLIENT_ID, fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubNetworkError);
    expect(errorText(error)).not.toContain(SECRET_DEVICE);
  });
});

describe('pollDeviceToken', () => {
  async function poll(response: GitHubResponseLike, now?: () => number): Promise<DevicePollResult> {
    const { fetch } = fakeFetch(() => response);
    return pollDeviceToken({
      clientId: CLIENT_ID,
      deviceCode: SECRET_DEVICE,
      fetch,
      ...(now === undefined ? {} : { now }),
    });
  }

  test('sends one form POST with the device grant to the token endpoint', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, tokenBody));
    await pollDeviceToken({ clientId: CLIENT_ID, deviceCode: SECRET_DEVICE, fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ACCESS_TOKEN_URL);
    expect(calls[0].url).not.toContain(SECRET_DEVICE);
    expect(params(calls[0].init.body)).toEqual({
      client_id: CLIENT_ID,
      device_code: SECRET_DEVICE,
      grant_type: DEVICE_GRANT_TYPE,
    });
  });

  test('returns the tokens with the expiry from expires_in and the injected clock', async () => {
    expect(await poll(jsonResponse(200, tokenBody), () => 1_000)).toEqual({
      status: 'ok',
      tokens: {
        accessToken: SECRET_ACCESS,
        refreshToken: SECRET_REFRESH,
        accessTokenExpiresAt: 1_000 + 28_800_000,
      },
    });
  });

  test('a non-expiring token has no refresh token and no expiry (default clock)', async () => {
    expect(
      await poll(jsonResponse(200, { access_token: SECRET_ACCESS, token_type: 'Bearer' })),
    ).toEqual({ status: 'ok', tokens: { accessToken: SECRET_ACCESS } });
  });

  test('maps every documented poll error, reading the code even on a 200', async () => {
    expect(await poll(jsonResponse(200, { error: 'authorization_pending' }))).toEqual({
      status: 'pending',
    });
    expect(await poll(jsonResponse(200, { error: 'slow_down', interval: 10 }))).toEqual({
      status: 'slowDown',
      interval: 10,
    });
    expect(await poll(jsonResponse(200, { error: 'slow_down' }))).toEqual({ status: 'slowDown' });
    expect(await poll(jsonResponse(200, { error: 'access_denied' }))).toEqual({ status: 'denied' });
    expect(await poll(jsonResponse(200, { error: 'expired_token' }))).toEqual({
      status: 'expired',
    });
    expect(await poll(jsonResponse(200, { error: 'token_expired' }))).toEqual({
      status: 'expired',
    });
    for (const code of GITHUB_FAILURE_CODES) {
      expect(await poll(jsonResponse(200, { error: code }))).toEqual({
        status: 'failed',
        reason: code,
      });
    }
    expect(await poll(jsonResponse(400, { error: 'something_else' }))).toEqual({
      status: 'failed',
      reason: 'unknown_error',
    });
  });

  test('a failing status, an unusable body, a network failure and an oversized body are failures', async () => {
    expect(await poll(jsonResponse(502, 'bad gateway'))).toEqual({
      status: 'failed',
      reason: 'http_error',
    });
    expect(
      await poll(jsonResponse(200, { access_token: SECRET_ACCESS, token_type: 'mac' })),
    ).toEqual({ status: 'failed', reason: 'invalid_response' });
    const network = await pollDeviceToken({
      clientId: CLIENT_ID,
      deviceCode: SECRET_DEVICE,
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(network).toEqual({ status: 'failed', reason: 'network' });
    expect(await poll(jsonResponse(200, 'x'.repeat(70 * 1024)))).toEqual({
      status: 'failed',
      reason: 'http_error',
    });
  });

  test('no result ever carries the device code', async () => {
    const result = await poll(
      jsonResponse(200, { error: 'incorrect_device_code', device_code: SECRET_DEVICE }),
    );
    expect(JSON.stringify(result)).not.toContain(SECRET_DEVICE);
  });
});

describe('waitForDeviceToken', () => {
  function clock() {
    let time = 0;
    const sleeps: number[] = [];
    return {
      now: () => time,
      sleep: (ms: number) => {
        sleeps.push(ms);
        time += ms;
        return Promise.resolve();
      },
      sleeps,
    };
  }

  function sequence(...bodies: { status?: number; body: unknown }[]) {
    return fakeFetch((_url, _init, index) => {
      const next = bodies[Math.min(index, bodies.length - 1)];
      return jsonResponse(next.status ?? 200, next.body);
    });
  }

  test('waits the interval before each poll and returns the tokens', async () => {
    const c = clock();
    const { fetch, calls } = sequence(
      { body: { error: 'authorization_pending' } },
      { body: { error: 'authorization_pending' } },
      { body: tokenBody },
    );
    const result = await waitForDeviceToken({
      clientId: CLIENT_ID,
      deviceCode: SECRET_DEVICE,
      interval: 5,
      expiresAt: 900_000,
      fetch,
      sleep: c.sleep,
      now: c.now,
    });
    expect(result.status).toBe('ok');
    expect(calls).toHaveLength(3);
    expect(c.sleeps).toEqual([5000, 5000, 5000]);
  });

  test('adds 5 seconds on slow_down, or uses the longer interval GitHub gives', async () => {
    const c = clock();
    const { fetch } = sequence(
      { body: { error: 'slow_down' } },
      { body: { error: 'slow_down', interval: 30 } },
      { body: { error: 'slow_down', interval: 2 } },
      { body: { error: 'access_denied' } },
    );
    const result = await waitForDeviceToken({
      clientId: CLIENT_ID,
      deviceCode: SECRET_DEVICE,
      interval: 5,
      expiresAt: 900_000,
      fetch,
      sleep: c.sleep,
      now: c.now,
    });
    expect(result).toEqual({ status: 'denied' });
    expect(c.sleeps).toEqual([5000, 10_000, 30_000, 35_000]);
    expect(SLOW_DOWN_SECONDS).toBe(5);
  });

  test('retries after a network failure and stops on a lasting failure', async () => {
    const c = clock();
    let index = 0;
    const result = await waitForDeviceToken({
      clientId: CLIENT_ID,
      deviceCode: SECRET_DEVICE,
      interval: 1,
      expiresAt: 900_000,
      fetch: () => {
        index += 1;
        return index === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(jsonResponse(200, { error: 'device_flow_disabled' }));
      },
      sleep: c.sleep,
      now: c.now,
    });
    expect(result).toEqual({ status: 'failed', reason: 'device_flow_disabled' });
    expect(index).toBe(2);
  });

  test('stops at expiry without another poll', async () => {
    const c = clock();
    const { fetch, calls } = sequence({ body: { error: 'authorization_pending' } });
    const result = await waitForDeviceToken({
      clientId: CLIENT_ID,
      deviceCode: SECRET_DEVICE,
      interval: 5,
      expiresAt: 12_000,
      fetch,
      sleep: c.sleep,
      now: c.now,
    });
    expect(result).toEqual({ status: 'expired' });
    expect(calls).toHaveLength(2);
    expect(c.sleeps).toEqual([5000, 5000, 5000]);
  });

  test('returns expired when GitHub says the code expired', async () => {
    const c = clock();
    const { fetch } = sequence({ body: { error: 'expired_token' } });
    expect(
      await waitForDeviceToken({
        clientId: CLIENT_ID,
        deviceCode: SECRET_DEVICE,
        interval: 5,
        expiresAt: 900_000,
        fetch,
        sleep: c.sleep,
        now: c.now,
      }),
    ).toEqual({ status: 'expired' });
  });

  test('stops when aborted before starting or while sleeping', async () => {
    const c = clock();
    const { fetch, calls } = sequence({ body: { error: 'authorization_pending' } });
    const before = new AbortController();
    before.abort();
    expect(
      await waitForDeviceToken({
        clientId: CLIENT_ID,
        deviceCode: SECRET_DEVICE,
        interval: 5,
        expiresAt: 900_000,
        fetch,
        sleep: c.sleep,
        now: c.now,
        signal: before.signal,
      }),
    ).toEqual({ status: 'aborted' });

    const during = new AbortController();
    expect(
      await waitForDeviceToken({
        clientId: CLIENT_ID,
        deviceCode: SECRET_DEVICE,
        interval: 5,
        expiresAt: 900_000,
        fetch,
        sleep: (ms, signal) => {
          expect(signal).toBe(during.signal);
          during.abort();
          return c.sleep(ms);
        },
        now: c.now,
        signal: during.signal,
      }),
    ).toEqual({ status: 'aborted' });
    expect(calls).toHaveLength(0);
  });
});

describe('refreshGitHubToken', () => {
  test('posts grant_type refresh_token with no client secret and returns the new pair', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, tokenBody));
    const tokens = await refreshGitHubToken({
      clientId: CLIENT_ID,
      refreshToken: 'ghr_OLD',
      fetch,
      now: () => 5,
    });
    expect(tokens).toEqual({
      accessToken: SECRET_ACCESS,
      refreshToken: SECRET_REFRESH,
      accessTokenExpiresAt: 5 + 28_800_000,
    });
    expect(calls[0].url).toBe(ACCESS_TOKEN_URL);
    expect(params(calls[0].init.body)).toEqual({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: 'ghr_OLD',
    });
    expect(calls[0].init.body).not.toContain('client_secret');
  });

  test('uses the real clock by default', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(200, tokenBody));
    const before = Date.now();
    const tokens = await refreshGitHubToken({ clientId: CLIENT_ID, refreshToken: 'r', fetch });
    expect(tokens.accessTokenExpiresAt).toBeGreaterThanOrEqual(before + 28_800_000);
  });

  test('a rejected refresh token means GitHub is no longer connected', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(200, { error: 'bad_refresh_token' }));
    const error = await refreshGitHubToken({
      clientId: CLIENT_ID,
      refreshToken: SECRET_REFRESH,
      fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubNotConnectedError);
    expect(errorText(error)).not.toContain(SECRET_REFRESH);
  });

  test('other refusals and unusable answers are sign-in errors with fixed reasons', async () => {
    const reason = async (response: GitHubResponseLike): Promise<string> => {
      const { fetch } = fakeFetch(() => response);
      const error = await refreshGitHubToken({
        clientId: CLIENT_ID,
        refreshToken: SECRET_REFRESH,
        fetch,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubSignInError);
      expect(errorText(error)).not.toContain(SECRET_REFRESH);
      return (error as GitHubSignInError).reason;
    };
    expect(await reason(jsonResponse(200, { error: 'unsupported_grant_type' }))).toBe(
      'unsupported_grant_type',
    );
    expect(await reason(jsonResponse(200, { error: 'unverified_user_email' }))).toBe(
      'unverified_user_email',
    );
    expect(await reason(jsonResponse(503, ''))).toBe('http_error');
    expect(await reason(jsonResponse(200, { refresh_token: SECRET_REFRESH }))).toBe(
      'invalid_response',
    );
  });
});
