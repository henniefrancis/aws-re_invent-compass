import { lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createQrPage,
  expiryLine,
  isPlainSvg,
  QR_PAGE_CSP,
  QR_PAGE_FILE,
  QR_PAGE_PREFIX,
  QR_PAGE_TITLE,
  qrPageHtml,
  STALE_PAGE_MS,
  svgDataUrl,
} from '../../src/adapters/qr-page.js';
import { QR_BRAND_ICON, QR_BRAND_LOGO } from '../../src/adapters/qr-brand.js';
import type { QrPageDeps, QrPageEntryStat, QrPageFs } from '../../src/adapters/qr-page.js';

// Feature: compass-power, task 48 (P3.3 to P3.5): the QR page in the browser.

const NOW = Date.parse('2026-11-30T16:00:00.000Z');
const EXPIRES = '2026-11-30T16:15:00.000Z';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M4 4.5h7"/></svg>\n';

/** Lets queued promise work finish. */
const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** An lstat result: a real folder of this user, made now, unless told otherwise. */
function entryStat(over: {
  directory?: boolean;
  symlink?: boolean;
  ageMs?: number;
  uid?: number;
}): QrPageEntryStat {
  return {
    isDirectory: () => over.directory ?? true,
    isSymbolicLink: () => over.symlink ?? false,
    mtimeMs: NOW - (over.ageMs ?? 0),
    uid: over.uid ?? 501,
  };
}

/** An in-memory file system that records every call. */
function memoryFs(fail: Partial<Record<keyof QrPageFs, boolean>> = {}) {
  const files = new Map<string, { data: string; mode: number; flag: string }>();
  const folders = new Set<string>();
  const removed: string[] = [];
  /** Entries left in the temp folder by other processes, by full path. */
  const others = new Map<string, QrPageEntryStat>();
  let made = 0;
  const fs: QrPageFs = {
    mkdtemp: (prefix) => {
      if (fail.mkdtemp === true) return Promise.reject(new Error('no temp'));
      made += 1;
      const folder = `${prefix}${String(made)}`;
      folders.add(folder);
      return Promise.resolve(folder);
    },
    writeFile: (path, data, options) => {
      if (fail.writeFile === true) return Promise.reject(new Error('disk full'));
      files.set(path, { data, ...options });
      return Promise.resolve();
    },
    rm: (path) => {
      if (fail.rm === true) return Promise.reject(new Error('busy'));
      removed.push(path);
      folders.delete(path);
      return Promise.resolve();
    },
    rmSync: (path) => {
      if (fail.rmSync === true) throw new Error('busy');
      removed.push(path);
      folders.delete(path);
    },
    readdir: (path) => {
      if (fail.readdir === true) return Promise.reject(new Error('no folder'));
      const all = [...folders, ...others.keys()].filter((entry) => !removed.includes(entry));
      return Promise.resolve(
        all.filter((entry) => dirname(entry) === path).map((entry) => basename(entry)),
      );
    },
    lstat: (path) => {
      if (fail.lstat === true) return Promise.reject(new Error('gone'));
      return Promise.resolve(others.get(path) ?? entryStat({}));
    },
  };
  return { fs, files, folders, removed, others };
}

function harness(
  options: { opens?: boolean; fail?: Partial<Record<keyof QrPageFs, boolean>> } = {},
) {
  const memory = memoryFs(options.fail);
  const opened: string[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const exits: (() => void)[] = [];
  const logged: string[] = [];
  const deps: QrPageDeps = {
    fs: memory.fs,
    tempRoot: join(tmpdir(), 'qr-root'),
    open: (path) => {
      opened.push(path);
      return Promise.resolve(options.opens ?? true);
    },
    now: () => NOW,
    wallNow: () => NOW,
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onExit: (fn) => {
      exits.push(fn);
    },
    uid: 501,
  };
  return { page: createQrPage(deps), memory, opened, timers, exits, logged };
}

describe('the QR page HTML', () => {
  test('is static: the CSP, no script, no link, the SVG, the expiry and the notices', () => {
    const html = qrPageHtml({ svg: SVG, expiresAt: EXPIRES });
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${QR_PAGE_CSP}">`);
    expect(QR_PAGE_CSP).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    );
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain(SVG);
    expect(html).toContain('This code works until 16:15 UTC.');
    expect(html).toContain('Unofficial. Your badge is your ticket.');
    expect(html).toContain('Do not share this QR code.');
    expect(html).not.toMatch(/<script|<iframe|<object|<embed|https?:\/\/(?!www\.w3\.org)/i);
    // The only link and image are the owner's icon and logo as data: URLs (task 49).
    const links = [...html.matchAll(/<link [^>]*>/g)].map((m) => m[0]);
    const images = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(links).toEqual([
      `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${QR_BRAND_ICON}">`,
    ]);
    expect(images).toEqual([
      `<img class="logo" src="data:image/svg+xml;base64,${QR_BRAND_LOGO}" alt="re:Invent Compass">`,
    ]);
    expect(html).not.toMatch(/(?:src|href)="(?!data:image\/svg\+xml;base64,)/);
  });

  test('is branded: the title, the favicon and the full logo above the heading (task 49)', () => {
    const html = qrPageHtml({ svg: SVG, expiresAt: EXPIRES });
    expect(QR_PAGE_TITLE).toBe('re:Invent Compass Boarding Pass');
    expect(html).toContain('<title>re:Invent Compass Boarding Pass</title>');
    expect(html.indexOf('<img class="logo"')).toBeGreaterThan(html.indexOf('<main>'));
    expect(html.indexOf('<img class="logo"')).toBeLessThan(
      html.indexOf('<h1>Scan with your phone camera</h1>'),
    );
    expect(svgDataUrl('QUJD')).toBe('data:image/svg+xml;base64,QUJD');
  });

  test('the embedded logo and icon are the site artwork, so they cannot drift (task 49)', () => {
    const artwork = (name: string) =>
      readFileSync(new URL(`../../../../site/public/artwork/${name}`, import.meta.url));
    expect(Buffer.from(QR_BRAND_LOGO, 'base64').equals(artwork('logo.svg'))).toBe(true);
    expect(Buffer.from(QR_BRAND_ICON, 'base64').equals(artwork('favicon.svg'))).toBe(true);
    for (const encoded of [QR_BRAND_LOGO, QR_BRAND_ICON]) {
      const svg = Buffer.from(encoded, 'base64').toString('utf8');
      expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+=|href="(?!#)/i);
    }
  });

  test('the expiry line is HH:MM in UTC', () => {
    expect(expiryLine('2026-12-01T00:15:00-08:00')).toBe('This code works until 08:15 UTC.');
  });

  test('only the shape the QR library makes is accepted (an allowlist)', () => {
    expect(isPlainSvg(SVG)).toBe(true);
    const head =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges">';
    expect(
      isPlainSvg(`${head}<path fill="#ffffff" d="M0 0h9v9H0z"/><path stroke="#000000" d="M4 4.5h1"/></svg>
`),
    ).toBe(true);
    for (const bad of [
      `${head}<use xlink:href="#x"/></svg>`,
      `${head}<path d="M0 0"/></svg><iframe src=x></iframe><svg></svg>`,
      `${head}<path/onload=x/></svg>`,
      `${head}<path d="M0" onload="x"/></svg>`,
      `${head}<set attributeName="href" to="x"/></svg>`,
      `${head}</svg>`,
      '<div></div>',
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="x()"></svg>',
      '<svg><a href="https://x">x</a></svg>',
      '<svg><foreignObject></foreignObject></svg>',
      '<svg><style>x{}</style></svg>',
      '<svg><![CDATA[x]]></svg>',
      '<svg><image xlink:href="javascript:x"/></svg>',
      `${SVG}<p>after</p>`,
    ]) {
      expect(isPlainSvg(bad), bad).toBe(false);
    }
  });
});

describe('createQrPage', () => {
  test('writes the page once, 0600 and wx, in a new compass-qr- folder, and opens it', async () => {
    const h = harness();
    expect(await h.page.show({ svg: SVG, expiresAt: EXPIRES })).toBe(true);
    const [folder] = [...h.memory.folders];
    expect(folder?.startsWith(join(tmpdir(), 'qr-root', QR_PAGE_PREFIX))).toBe(true);
    const path = join(folder ?? '', QR_PAGE_FILE);
    expect(h.memory.files.get(path)).toMatchObject({ mode: 0o600, flag: 'wx' });
    expect(h.memory.files.get(path)?.data).toBe(qrPageHtml({ svg: SVG, expiresAt: EXPIRES }));
    expect(h.opened).toEqual([path]);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.ms).toBe(15 * 60 * 1000);
  });

  test('the page is deleted when the link expires', async () => {
    const h = harness();
    await h.page.show({ svg: SVG, expiresAt: EXPIRES });
    const [folder] = [...h.memory.folders];
    h.timers[0]?.fn();
    await tick();
    expect(h.memory.removed).toEqual([folder]);
    expect(h.memory.folders.size).toBe(0);
  });

  test('a newer page replaces the old one, whose timer is cancelled and no longer deletes', async () => {
    const h = harness();
    await h.page.show({ svg: SVG, expiresAt: EXPIRES });
    const [first] = [...h.memory.folders];
    await h.page.show({ svg: SVG, expiresAt: EXPIRES });
    expect(h.memory.removed).toEqual([first]);
    expect(h.timers[0]?.cancelled).toBe(true);
    const [second] = [...h.memory.folders];
    // A stale timer that still fires does not remove the newer page.
    h.timers[0]?.fn();
    await tick();
    expect(h.memory.folders.has(second ?? '')).toBe(true);
  });

  test('clear() deletes the page now, and does nothing when there is none', async () => {
    const h = harness();
    await h.page.clear();
    expect(h.memory.removed).toEqual([]);
    await h.page.show({ svg: SVG, expiresAt: EXPIRES });
    const [folder] = [...h.memory.folders];
    await h.page.clear();
    expect(h.memory.removed).toEqual([folder]);
    expect(h.timers[0]?.cancelled).toBe(true);
  });

  test('the exit hook is registered once, with the first page, and deletes the current page', async () => {
    const h = harness();
    expect(h.exits).toHaveLength(0);
    await h.page.show({ svg: SVG, expiresAt: EXPIRES });
    await h.page.show({ svg: SVG, expiresAt: EXPIRES });
    expect(h.exits).toHaveLength(1);
    const [folder] = [...h.memory.folders];
    h.exits[0]?.();
    expect(h.memory.removed.at(-1)).toBe(folder);
    // With no page left the hook does nothing.
    const cleared = harness();
    await cleared.page.show({ svg: SVG, expiresAt: EXPIRES });
    await cleared.page.clear();
    const count = cleared.memory.removed.length;
    cleared.exits[0]?.();
    expect(cleared.memory.removed).toHaveLength(count);
  });

  test('a browser that does not open gives false and removes the page at once', async () => {
    const h = harness({ opens: false });
    expect(await h.page.show({ svg: SVG, expiresAt: EXPIRES })).toBe(false);
    expect(h.memory.folders.size).toBe(0);
    expect(h.timers[0]?.cancelled).toBe(true);
  });

  test('a refused SVG, an expired link, an unreadable expiry or one over a day ahead opens nothing', async () => {
    const h = harness();
    expect(await h.page.show({ svg: '<svg><script></script></svg>', expiresAt: EXPIRES })).toBe(
      false,
    );
    expect(await h.page.show({ svg: SVG, expiresAt: '2026-11-30T15:59:00.000Z' })).toBe(false);
    expect(await h.page.show({ svg: SVG, expiresAt: 'soon' })).toBe(false);
    expect(await h.page.show({ svg: SVG, expiresAt: '2026-12-02T16:00:01.000Z' })).toBe(false);
    expect(h.opened).toEqual([]);
    expect(h.memory.files.size).toBe(0);
  });

  test('file system failures give false and leave nothing behind; they never throw', async () => {
    const noTemp = harness({ fail: { mkdtemp: true } });
    expect(await noTemp.page.show({ svg: SVG, expiresAt: EXPIRES })).toBe(false);
    expect(noTemp.opened).toEqual([]);

    const noWrite = harness({ fail: { writeFile: true } });
    expect(await noWrite.page.show({ svg: SVG, expiresAt: EXPIRES })).toBe(false);
    expect(noWrite.memory.folders.size).toBe(0);
    expect(noWrite.opened).toEqual([]);

    const noRemove = harness({ fail: { rm: true, rmSync: true } });
    await noRemove.page.show({ svg: SVG, expiresAt: EXPIRES });
    await expect(noRemove.page.clear()).resolves.toBeUndefined();
    await noRemove.page.show({ svg: SVG, expiresAt: EXPIRES });
    expect(() => noRemove.exits[0]?.()).not.toThrow();
  });

  // Security review M2: pages a killed process left behind are swept with the first new page.
  test('the first page sweeps old compass-qr- folders of this user, and only those', async () => {
    const h = harness();
    const root = join(tmpdir(), 'qr-root');
    const at = (name: string) => join(root, name);
    h.memory.others.set(at(`${QR_PAGE_PREFIX}old`), entryStat({ ageMs: STALE_PAGE_MS + 1 }));
    h.memory.others.set(at(`${QR_PAGE_PREFIX}fresh`), entryStat({ ageMs: STALE_PAGE_MS - 1 }));
    h.memory.others.set(
      at(`${QR_PAGE_PREFIX}link`),
      entryStat({ symlink: true, ageMs: STALE_PAGE_MS * 2 }),
    );
    h.memory.others.set(
      at(`${QR_PAGE_PREFIX}file`),
      entryStat({ directory: false, ageMs: STALE_PAGE_MS * 2 }),
    );
    h.memory.others.set(
      at(`${QR_PAGE_PREFIX}theirs`),
      entryStat({ uid: 0, ageMs: STALE_PAGE_MS * 2 }),
    );
    h.memory.others.set(at('someone-else-old'), entryStat({ ageMs: STALE_PAGE_MS * 2 }));
    await h.page.show({ svg: SVG, expiresAt: EXPIRES });
    expect(h.memory.removed).toEqual([at(`${QR_PAGE_PREFIX}old`)]);
    // The sweep runs once, not with every page.
    h.memory.others.set(at(`${QR_PAGE_PREFIX}old2`), entryStat({ ageMs: STALE_PAGE_MS * 2 }));
    await h.page.show({ svg: SVG, expiresAt: EXPIRES });
    expect(h.memory.removed).not.toContain(at(`${QR_PAGE_PREFIX}old2`));
  });

  test('without a uid (Windows) any old page folder is swept; read failures are skipped', async () => {
    const memory = memoryFs();
    const root = join(tmpdir(), 'qr-root');
    memory.others.set(
      join(root, `${QR_PAGE_PREFIX}old`),
      entryStat({ uid: 0, ageMs: STALE_PAGE_MS * 2 }),
    );
    const page = createQrPage({
      fs: memory.fs,
      tempRoot: root,
      open: () => Promise.resolve(true),
      now: () => NOW,
      wallNow: () => NOW,
      schedule: () => () => undefined,
      onExit: () => undefined,
    });
    await page.show({ svg: SVG, expiresAt: EXPIRES });
    expect(memory.removed).toEqual([join(root, `${QR_PAGE_PREFIX}old`)]);
    for (const fail of [{ readdir: true }, { lstat: true }]) {
      const h = harness({ fail });
      h.memory.others.set(
        join(root, `${QR_PAGE_PREFIX}old`),
        entryStat({ ageMs: STALE_PAGE_MS * 2 }),
      );
      expect(await h.page.show({ svg: SVG, expiresAt: EXPIRES })).toBe(true);
      expect(h.memory.removed).toEqual([]);
    }
  });

  test('folder ages use the real time, not the pinned simulated clock', async () => {
    const memory = memoryFs();
    const root = join(tmpdir(), 'qr-root');
    memory.others.set(join(root, `${QR_PAGE_PREFIX}live`), entryStat({ ageMs: 60_000 }));
    const page = createQrPage({
      fs: memory.fs,
      tempRoot: root,
      open: () => Promise.resolve(true),
      // The simulated clock is weeks ahead of the real one.
      now: () => NOW + 30 * 24 * 60 * 60 * 1000,
      wallNow: () => NOW,
      schedule: () => () => undefined,
      onExit: () => undefined,
    });
    await page.show({
      svg: SVG,
      expiresAt: new Date(NOW + 30 * 24 * 60 * 60 * 1000 + 600_000).toISOString(),
    });
    expect(memory.removed).toEqual([]);
  });

  test('an opener that rejects does not jam the queue for the next call', async () => {
    const memory = memoryFs();
    let calls = 0;
    const page = createQrPage({
      fs: memory.fs,
      tempRoot: join(tmpdir(), 'qr-root'),
      open: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('opener broke')) : Promise.resolve(true);
      },
      now: () => NOW,
      wallNow: () => NOW,
      schedule: () => () => undefined,
      onExit: () => undefined,
    });
    await expect(page.show({ svg: SVG, expiresAt: EXPIRES })).rejects.toThrow('opener broke');
    expect(await page.show({ svg: SVG, expiresAt: EXPIRES })).toBe(true);
  });

  // Security review M3: overlapping calls run one at a time, so no folder is orphaned.
  test('two overlapping shows leave only the newer page, and clear waits its turn', async () => {
    const h = harness();
    const first = h.page.show({ svg: SVG, expiresAt: EXPIRES });
    const second = h.page.show({ svg: SVG, expiresAt: EXPIRES });
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(h.memory.folders.size).toBe(1);
    expect(h.memory.removed).toHaveLength(1);
    const shown = h.page.show({ svg: SVG, expiresAt: EXPIRES });
    const cleared = h.page.clear();
    await Promise.all([shown, cleared]);
    expect(h.memory.folders.size).toBe(0);
  });

  test('on a real disk the page is a 0600 file in its own folder, and is gone after clear()', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'compass-qr-test-'));
    const opened: string[] = [];
    const page = createQrPage({
      fs: {
        mkdtemp: (prefix) => mkdtemp(prefix),
        writeFile: (path, data, options) => writeFile(path, data, options),
        rm: (path, options) => rm(path, options),
        rmSync: (path, options) => {
          rmSync(path, options);
        },
        readdir: (path) => readdir(path),
        lstat: (path) => lstat(path),
      },
      tempRoot,
      open: (path) => {
        opened.push(path);
        return Promise.resolve(true);
      },
      now: () => NOW,
      wallNow: () => NOW,
      schedule: () => () => undefined,
      onExit: () => undefined,
    });
    expect(await page.show({ svg: SVG, expiresAt: EXPIRES })).toBe(true);
    const path = opened[0] ?? '';
    expect(await readFile(path, 'utf8')).toContain(SVG);
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    await page.clear();
    expect(await readdir(tempRoot)).toEqual([]);
    await rm(tempRoot, { recursive: true, force: true });
  });
});
