import fc from 'fast-check';
import { inflateSync } from 'node:zlib';
import QRCode from 'qrcode';
import { describe, expect, test, vi } from 'vitest';
import { createCompassClient } from '../../src/passes/compass-client.js';
import {
  createHandoffBuilder,
  PNG_SCALE,
  QUIET_ZONE,
  renderChatText,
  renderTerminalQr,
} from '../../src/passes/handoff-builder.js';
import type { HandoffBuilderDeps } from '../../src/passes/handoff-builder.js';
import { PassError } from '../../src/passes/redaction.js';
import { createContractMock, jsonResponse } from './openapi-mock.js';
import { NUM_RUNS, fakeClock, fakeIdToken, TEST_HOSTS } from './support.js';

// Tests for Handoff_Builder (boarding-passes, S4, Requirement 5). Property 18 compares the
// three renders with one QRCode.create of the same Board_URL. No QR decoder is used: each
// render is read back into a module matrix (text by its block characters, the PNG by its
// pixels) and that matrix must equal the one the library built.

const SERIAL = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';
const INCLUDE = { apple: true, google: false, calendar: true };
const ESC = String.fromCharCode(0x1b);
const ANSI_PREFIX = `${ESC}[30;47m`;
const ANSI_SUFFIX = `${ESC}[0m`;
const SENTINEL_HANDOFF_ID = 'Zk3pQ9sLw2VnR8xT5yBc7A';
const BASE_URL = 'https://d111111abcdef8.cloudfront.net';
const SENTINEL_BOARD_URL = `${BASE_URL}/board#h=${SENTINEL_HANDOFF_ID}`;

type Matrix = boolean[][];

/** The reference matrix: what the library builds for the URL. */
function referenceMatrix(url: string): { matrix: Matrix; size: number } {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const matrix: Matrix = [];
  for (let row = 0; row < modules.size; row += 1) {
    matrix.push(Array.from({ length: modules.size }, (_, col) => modules.get(row, col) === 1));
  }
  return { matrix, size: modules.size };
}

/** Read the inner matrix back out of the terminal render. */
function decodeTerminal(text: string, size: number): Matrix {
  const grid: boolean[][] = [];
  for (const line of text.split('\n')) {
    expect(line.startsWith(ANSI_PREFIX)).toBe(true);
    expect(line.endsWith(ANSI_SUFFIX)).toBe(true);
    const cells = [...line.slice(ANSI_PREFIX.length, line.length - ANSI_SUFFIX.length)];
    grid.push(cells.map((cell) => cell === '\u{2588}' || cell === '\u{2580}'));
    grid.push(cells.map((cell) => cell === '\u{2588}' || cell === '\u{2584}'));
  }
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => grid[row + QUIET_ZONE]?.[col + QUIET_ZONE] === true),
  );
}

/** Read the inner matrix back out of the chat text render. */
function decodeChat(text: string, size: number): Matrix {
  const lines = text.split('\n');
  return Array.from({ length: size }, (_, row) =>
    Array.from(
      { length: size },
      (_, col) =>
        (lines[row + QUIET_ZONE] ?? '').slice(
          2 * (col + QUIET_ZONE),
          2 * (col + QUIET_ZONE) + 2,
        ) === '\u{2588}\u{2588}',
    ),
  );
}

/** Decode an 8-bit non-interlaced PNG into rows of RGBA bytes. */
function decodePng(bytes: Uint8Array): {
  width: number;
  height: number;
  rows: Uint8Array[];
  bpp: number;
} {
  const buffer = Buffer.from(bytes);
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const data: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect(body[8]).toBe(8);
      colorType = body[9];
      expect(body[12]).toBe(0);
    } else if (type === 'IDAT') {
      data.push(body);
    }
    offset += 12 + length;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * bpp;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    const prior = rows[y - 1] ?? new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? line[i - bpp] : 0;
      const up = prior[i];
      const upLeft = i >= bpp ? prior[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[i] = (line[i] + add) & 0xff;
    }
    rows.push(line);
  }
  return { width, height, rows, bpp };
}

/** Read the inner matrix back out of the PNG by sampling the centre of each module. */
function decodePngMatrix(bytes: Uint8Array, size: number): Matrix {
  const { width, height, rows, bpp } = decodePng(bytes);
  expect(width).toBe((size + 2 * QUIET_ZONE) * PNG_SCALE);
  expect(height).toBe(width);
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const x = (col + QUIET_ZONE) * PNG_SCALE + Math.floor(PNG_SCALE / 2);
      const y = (row + QUIET_ZONE) * PNG_SCALE + Math.floor(PNG_SCALE / 2);
      return rows[y][x * bpp] < 128;
    }),
  );
}

/** Put a fixed hand-off answer behind the client seam, with the clock fixed at 08:00 UTC. */
function depsAnswering(
  handoffId: string,
  boardUrl: string,
  options: { baseUrl?: string; expiresAt?: string } = {},
): HandoffBuilderDeps & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    clock: fakeClock(),
    client: {
      origin: options.baseUrl ?? BASE_URL,
      createHandoff(request) {
        requests.push(request);
        return Promise.resolve({
          handoffId,
          boardUrl,
          expiresAt: options.expiresAt ?? '2026-12-01T08:15:00Z',
        });
      },
    },
  };
}

async function failureOf(promise: Promise<unknown>): Promise<PassError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PassError);
    return error as PassError;
  }
  throw new Error('expected the call to fail');
}

describe('Feature: boarding-passes, Property 18: the three QR renders encode the same Board_URL data', () => {
  const boardUrlArb = fc
    .tuple(fc.stringMatching(/^[a-z0-9]{8,14}$/), fc.stringMatching(/^[A-Za-z0-9_-]{22}$/))
    .map(([host, capability]) => ({
      handoffId: capability,
      baseUrl: `https://${host}.cloudfront.net`,
      boardUrl: `https://${host}.cloudfront.net/board#h=${capability}`,
    }));

  test('all three renders read back to the matrix of one QRCode.create, fragment intact', async () => {
    await fc.assert(
      fc.asyncProperty(boardUrlArb, async ({ handoffId, baseUrl, boardUrl }) => {
        const deps = depsAnswering(handoffId, boardUrl, { baseUrl });
        const renders = await createHandoffBuilder(deps).handoff([SERIAL], INCLUDE);

        const reference = QRCode.create(boardUrl, { errorCorrectionLevel: 'M' });
        const { matrix, size } = referenceMatrix(boardUrl);

        // The symbol encodes exactly the Board_URL, fragment included.
        const encoded = reference.segments
          .map((segment) =>
            typeof segment.data === 'string' ? segment.data : Buffer.from(segment.data).toString(),
          )
          .join('');
        expect(encoded).toBe(boardUrl);
        expect(encoded.endsWith(`#h=${handoffId}`)).toBe(true);

        expect(decodeTerminal(renders.terminalQr, size)).toEqual(matrix);
        expect(decodeChat(renders.chatText, size)).toEqual(matrix);
        expect(decodePngMatrix(renders.chatPng, size)).toEqual(matrix);
        expect(renders.chatText.includes(ESC)).toBe(false);
        expect(deps.requests).toEqual([{ serialNumbers: [SERIAL], include: INCLUDE }]);
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);
});

describe('Feature: boarding-passes, Handoff_Builder example tests', () => {
  test('the hand-off goes through the real client and the contract, and renders three QR codes', async () => {
    const mock = createContractMock();
    mock.enqueue(
      'createHandoff',
      jsonResponse(201, {
        handoffId: SENTINEL_HANDOFF_ID,
        boardUrl: SENTINEL_BOARD_URL,
        expiresAt: '2026-12-01T08:15:00Z',
      }),
    );
    const clock = fakeClock();
    const client = createCompassClient({
      baseUrl: BASE_URL,
      allowedHosts: TEST_HOSTS,
      transport: mock,
      clock,
      idToken: { getIdToken: () => Promise.resolve(fakeIdToken('attendee')) },
    });
    const renders = await createHandoffBuilder({ client, clock }).handoff([SERIAL], INCLUDE);
    expect(mock.requests[0]?.body).toEqual({ serialNumbers: [SERIAL], include: INCLUDE });
    expect(mock.requests[0]?.violations).toEqual([]);
    expect(renders.terminalQr.length).toBeGreaterThan(0);
    expect(renders.chatPng.length).toBeGreaterThan(100);
  });

  test('the terminal QR uses block characters on a black-on-white colour, the chat text uses none', async () => {
    const renders = await createHandoffBuilder(
      depsAnswering(SENTINEL_HANDOFF_ID, SENTINEL_BOARD_URL),
    ).handoff([SERIAL], INCLUDE);
    const lines = renders.terminalQr.split('\n');
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect(line.startsWith(ANSI_PREFIX)).toBe(true);
      expect(line.endsWith(ANSI_SUFFIX)).toBe(true);
    }
    expect(renders.terminalQr).toMatch(/[\u{2580}\u{2584}\u{2588}]/u);
    expect(renders.chatText).toMatch(/\u{2588}/u);
    expect(renders.chatText).not.toContain(ESC);
    expect(Array.from(renders.chatPng.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test('the renders match their snapshots for a fixed board URL (Requirement 9.1)', () => {
    const { modules } = QRCode.create(SENTINEL_BOARD_URL, { errorCorrectionLevel: 'M' });
    expect(renderChatText(modules)).toMatchSnapshot();
    expect(renderTerminalQr(modules).split(ESC).join('<ESC>')).toMatchSnapshot();
  });

  // Feature: boarding-passes, Requirement 5.6 (task 13): an SVG render for a browser page.
  test('the SVG render is the same symbol as an SVG document with no link text', async () => {
    const renders = await createHandoffBuilder(
      depsAnswering(SENTINEL_HANDOFF_ID, SENTINEL_BOARD_URL),
    ).handoff([SERIAL], INCLUDE);
    const expected = await QRCode.toString(SENTINEL_BOARD_URL, {
      errorCorrectionLevel: 'M',
      margin: 4,
      type: 'svg',
    });
    expect(renders.svg).toBe(expected);
    expect(renders.svg.startsWith('<svg')).toBe(true);
    const { size } = referenceMatrix(SENTINEL_BOARD_URL);
    expect(renders.svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
    expect(renders.svg).not.toContain(SENTINEL_HANDOFF_ID);
    expect(renders.svg).not.toContain('board');
    expect(renders.svg).not.toMatch(/<script|<a |href=/i);
  });

  test('the QR encodes the parsed, normalised href, not the server string', async () => {
    const shouting = `https://D111111ABCDEF8.cloudfront.net/board#h=${SENTINEL_HANDOFF_ID}`;
    const renders = await createHandoffBuilder(
      depsAnswering(SENTINEL_HANDOFF_ID, shouting),
    ).handoff([SERIAL], INCLUDE);
    const { matrix, size } = referenceMatrix(SENTINEL_BOARD_URL);
    expect(decodeChat(renders.chatText, size)).toEqual(matrix);
  });

  test('a board URL that is not the exact expected link is refused without echo (QA M6, security M3)', async () => {
    const id = SENTINEL_HANDOFF_ID;
    const bad: [string, string, string?][] = [
      [id, 'not a url'],
      [id, `http://d111111abcdef8.cloudfront.net/board#h=${id}`],
      [id, `https://user:pw@d111111abcdef8.cloudfront.net/board#h=${id}`],
      [id, `https://evilevil1234.cloudfront.net/board#h=${id}`],
      [id, `https://d111111abcdef8.cloudfront.net/board/#h=${id}`],
      [id, `https://d111111abcdef8.cloudfront.net/other#h=${id}`],
      [id, `https://d111111abcdef8.cloudfront.net/board?x=1#h=${id}`],
      [id, `https://d111111abcdef8.cloudfront.net/board?id=${id}`],
      [id, `https://d111111abcdef8.cloudfront.net/board#${id}`],
      [id, `https://d111111abcdef8.cloudfront.net/board#h=${id}x`],
      [id, `https://d111111abcdef8.cloudfront.net/board#h=${id.slice(1)}A`],
      [id, 'https://d111111abcdef8.cloudfront.net/board#h='],
      ['short', 'https://d111111abcdef8.cloudfront.net/board#h=short'],
      ['', 'https://d111111abcdef8.cloudfront.net/board#h='],
      [
        'not url safe!not url!',
        'https://d111111abcdef8.cloudfront.net/board#h=not url safe!not url!',
      ],
    ];
    for (const [handoffId, boardUrl] of bad) {
      const error = await failureOf(
        createHandoffBuilder(depsAnswering(handoffId, boardUrl)).handoff([SERIAL], INCLUDE),
      );
      expect(error.code).toBe('handoff.invalid_board_url');
      expect(error.message).not.toContain(SENTINEL_HANDOFF_ID);
      expect(error.message).not.toContain('cloudfront');
    }
  });

  test('an expiry more than 24 hours ahead is refused, and exactly 24 hours is accepted', async () => {
    const deps = (expiresAt: string) =>
      depsAnswering(SENTINEL_HANDOFF_ID, SENTINEL_BOARD_URL, { expiresAt });
    const error = await failureOf(
      createHandoffBuilder(deps('2026-12-02T08:00:01Z')).handoff([SERIAL], INCLUDE),
    );
    expect(error.code).toBe('handoff.invalid_expiry');
    expect(error.message).not.toContain(SENTINEL_HANDOFF_ID);
    await expect(
      createHandoffBuilder(deps('2026-12-02T08:00:00Z')).handoff([SERIAL], INCLUDE),
    ).resolves.toBeDefined();
  });

  test('a QR library failure is a fixed PassError that names nothing', async () => {
    const create = vi.spyOn(QRCode, 'create').mockImplementationOnce(() => {
      throw new Error(`library says ${SENTINEL_BOARD_URL}`);
    });
    const error = await failureOf(
      createHandoffBuilder(depsAnswering(SENTINEL_HANDOFF_ID, SENTINEL_BOARD_URL)).handoff(
        [SERIAL],
        INCLUDE,
      ),
    );
    create.mockRestore();
    expect(error.code).toBe('handoff.qr_failed');
    expect(error.message).toBe('The hand-off link could not be turned into a QR code.');
  });

  test('an SVG render failure is the same fixed PassError', async () => {
    const toString = vi.spyOn(QRCode, 'toString').mockImplementationOnce(() => {
      throw new Error(`library says ${SENTINEL_BOARD_URL}`);
    });
    const error = await failureOf(
      createHandoffBuilder(depsAnswering(SENTINEL_HANDOFF_ID, SENTINEL_BOARD_URL)).handoff(
        [SERIAL],
        INCLUDE,
      ),
    );
    toString.mockRestore();
    expect(error.code).toBe('handoff.qr_failed');
    expect(error.message).not.toContain(SENTINEL_HANDOFF_ID);
  });
});

describe('Feature: boarding-passes, expiry in the past and origin normalisation (QA N5, security N5)', () => {
  test('an expiry that is not in the future is refused', async () => {
    // The clock is fixed at 08:00:00 UTC.
    for (const expiresAt of [
      '2026-12-01T08:00:00Z',
      '2026-12-01T07:59:59Z',
      '2020-01-01T00:00:00Z',
    ]) {
      const error = await failureOf(
        createHandoffBuilder(
          depsAnswering(SENTINEL_HANDOFF_ID, SENTINEL_BOARD_URL, { expiresAt }),
        ).handoff([SERIAL], INCLUDE),
      );
      expect(error.code).toBe('handoff.invalid_expiry');
    }
    await expect(
      createHandoffBuilder(
        depsAnswering(SENTINEL_HANDOFF_ID, SENTINEL_BOARD_URL, {
          expiresAt: '2026-12-01T08:00:01Z',
        }),
      ).handoff([SERIAL], INCLUDE),
    ).resolves.toBeDefined();
  });

  test('the board origin is compared case-insensitively and the default :443 is dropped', async () => {
    const { matrix, size } = referenceMatrix(SENTINEL_BOARD_URL);
    for (const boardUrl of [
      `https://D111111ABCDEF8.CLOUDFRONT.NET/board#h=${SENTINEL_HANDOFF_ID}`,
      `https://d111111abcdef8.cloudfront.net:443/board#h=${SENTINEL_HANDOFF_ID}`,
    ]) {
      const renders = await createHandoffBuilder(
        depsAnswering(SENTINEL_HANDOFF_ID, boardUrl),
      ).handoff([SERIAL], INCLUDE);
      expect(decodeChat(renders.chatText, size)).toEqual(matrix);
    }
    // A client origin written with an upper-case host or the default port is normalised too.
    const renders = await createHandoffBuilder(
      depsAnswering(SENTINEL_HANDOFF_ID, SENTINEL_BOARD_URL, {
        baseUrl: 'https://D111111ABCDEF8.cloudfront.net:443',
      }),
    ).handoff([SERIAL], INCLUDE);
    expect(decodeChat(renders.chatText, size)).toEqual(matrix);
    // A different port is a different origin.
    const error = await failureOf(
      createHandoffBuilder(
        depsAnswering(
          SENTINEL_HANDOFF_ID,
          `https://d111111abcdef8.cloudfront.net:8443/board#h=${SENTINEL_HANDOFF_ID}`,
        ),
      ).handoff([SERIAL], INCLUDE),
    );
    expect(error.code).toBe('handoff.invalid_board_url');
  });
});
