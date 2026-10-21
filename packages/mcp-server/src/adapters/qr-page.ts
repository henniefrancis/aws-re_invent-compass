// The QR page (compass-power task 48, Requirements P3.3 to P3.5, design "Owner change: link or
// QR code"). Each page gets its own new folder under the OS temp folder (mkdtemp, prefix
// compass-qr-) and is written once with mode 0600 and flag wx, so nothing else can have made the
// file first. The page is static: the SVG QR code, the expiry and the notices, under a Content
// Security Policy that allows no script and nothing from outside the page. The QR code is a live
// capability until it expires, so the folder is deleted at the expiry (by a timer that never
// keeps the process alive), when a newer page replaces it, on clear() (forget_me) and when the
// process exits or is stopped by a signal. A page left behind by a killed process is swept the
// next time a page is shown. show and clear run one at a time, so two calls never leave an
// orphan. Neither the link nor the path is ever logged; failures resolve false and the tool falls
// back to the QR code in the chat.

import { join } from 'node:path';
import type { QrPagePort } from '../ports/qr-page-port.js';
import { QR_BRAND_ICON, QR_BRAND_LOGO } from './qr-brand.js';

/** The file name inside the page's own folder. */
export const QR_PAGE_FILE = 'board-qr.html';
/** The prefix of each page folder under the temp folder. */
export const QR_PAGE_PREFIX = 'compass-qr-';
/**
 * The Content Security Policy of the page: nothing runs and nothing loads, and the page cannot
 * set a base URL or submit a form (security review L1).
 */
export const QR_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
/** A hand-off lives for 15 minutes; a page for anything beyond a day ahead is refused. */
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
/**
 * A page folder older than this was left by a process that was killed (security review M2). It
 * is longer than a hand-off lives, so a page another Compass server is still showing is kept.
 */
export const STALE_PAGE_MS = 20 * 60 * 1000;

/** What lstat reports that the sweep needs. */
export interface QrPageEntryStat {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mtimeMs: number;
  uid: number;
}

/** The file operations the page needs (node:fs/promises and node:fs in production). */
export interface QrPageFs {
  mkdtemp(prefix: string): Promise<string>;
  writeFile(path: string, data: string, options: { mode: number; flag: string }): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  rmSync(path: string, options: { recursive: true; force: true }): void;
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<QrPageEntryStat>;
}

/** What the QR page needs. */
export interface QrPageDeps {
  fs: QrPageFs;
  /** The OS temp folder. */
  tempRoot: string;
  /** Opens an absolute .html path in the browser; true when it opened. */
  open(path: string): Promise<boolean>;
  /** The runtime clock, which the hand-off expiry is in (pinned in simulated mode). */
  now(): number;
  /** The real time, for the age of folders on disk (the sweep). */
  wallNow(): number;
  /** Runs fn after ms without keeping the process alive; returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
  /** Registers fn to run once when the process exits or is stopped by a signal. */
  onExit(fn: () => void): void;
  /** This process's user id on POSIX; left out on Windows, where the temp folder is per user. */
  uid?: number | undefined;
}

const SHARING_NOTE =
  'Do not share this QR code. Anyone who has it can see these passes until it expires.';
const DISCLAIMER = 'Unofficial. Your badge is your ticket.';

/** The text of the page's expiry line: the expiry as HH:MM in UTC. */
export function expiryLine(expiresAt: string): string {
  return `This code works until ${new Date(expiresAt).toISOString().slice(11, 16)} UTC.`;
}

/**
 * The exact shape the QR library makes: one svg element with the SVG namespace, a numeric
 * viewBox and optionally crisp edges, holding only path elements with a hex fill or stroke and
 * path data. Anything else is refused (an allowlist, security review L1).
 */
const QR_SVG =
  /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[0-9 ]+"(?: shape-rendering="crispEdges")?>(?:<path(?: (?:fill|stroke)="#[0-9a-fA-F]{6}")? d="[MmHhVvZz0-9 .]*"\/>)+<\/svg>\s*$/;

/** True when the SVG is exactly what the QR library makes. */
export function isPlainSvg(svg: string): boolean {
  return QR_SVG.test(svg);
}

/** The page title (task 49). */
export const QR_PAGE_TITLE = 're:Invent Compass Boarding Pass';

/** An owner SVG as a data: URL, the only kind of image the page's CSP allows. */
export function svgDataUrl(base64: string): string {
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * The page: static HTML with the SVG QR code inline, branded with the owner's icon and logo
 * (task 49) in the colours of the Apple pass.
 */
export function qrPageHtml(page: { svg: string; expiresAt: string }): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${QR_PAGE_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${QR_PAGE_TITLE}</title>`,
    `<link rel="icon" type="image/svg+xml" href="${svgDataUrl(QR_BRAND_ICON)}">`,
    '<style>',
    'body{margin:0;font-family:system-ui,sans-serif;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#000 linear-gradient(160deg,#05052e 0%,#2236f0 40%,#2b34ee 60%,#e61ee8 85%,#ff6a20 100%) fixed}',
    'main{text-align:center;padding:24px;margin:16px;max-width:440px;background:rgba(0,0,0,.6);border-radius:16px}',
    '.logo{width:min(280px,70vw);height:auto;display:block;margin:0 auto 8px}',
    'h1{color:#f09740;font-size:1.4rem;margin:8px 0 16px}',
    '.qr{background:#fff;display:inline-block;padding:8px;border-radius:8px}',
    '.qr svg{width:min(360px,80vw);height:auto;display:block}',
    'p{margin:12px 0}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<img class="logo" src="${svgDataUrl(QR_BRAND_LOGO)}" alt="re:Invent Compass">`,
    '<h1>Scan with your phone camera</h1>',
    `<div class="qr">${page.svg}</div>`,
    `<p>${expiryLine(page.expiresAt)}</p>`,
    `<p>${SHARING_NOTE}</p>`,
    `<p>${DISCLAIMER}</p>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Creates the QR page. */
export function createQrPage(deps: QrPageDeps): QrPagePort {
  let current: { folder: string; cancel: () => void } | undefined;

  // show and clear run one at a time (security review M3): each waits for the one before.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };

  const removeNow = async (): Promise<void> => {
    const page = current;
    current = undefined;
    if (page === undefined) {
      return;
    }
    page.cancel();
    try {
      await deps.fs.rm(page.folder, { recursive: true, force: true });
    } catch {
      // Nothing to report: the folder is private and the link expires by itself.
    }
  };

  /** Removes page folders a killed process left behind: real folders of ours, older than a link lives. */
  const sweep = async (): Promise<void> => {
    let names: string[];
    try {
      names = await deps.fs.readdir(deps.tempRoot);
    } catch {
      return;
    }
    for (const name of names.filter((entry) => entry.startsWith(QR_PAGE_PREFIX))) {
      const folder = join(deps.tempRoot, name);
      try {
        const entry = await deps.fs.lstat(folder);
        const ours = deps.uid === undefined || entry.uid === deps.uid;
        const stale = deps.wallNow() - entry.mtimeMs > STALE_PAGE_MS;
        if (entry.isDirectory() && !entry.isSymbolicLink() && ours && stale) {
          await deps.fs.rm(folder, { recursive: true, force: true });
        }
      } catch {
        // Gone already, or not ours to read: leave it.
      }
    }
  };

  // The exit clean-up and the sweep run with the first page, so a runtime that never shows one
  // adds no process listener and reads no folder.
  let started = false;
  const start = async (): Promise<void> => {
    if (started) {
      return;
    }
    started = true;
    deps.onExit(() => {
      if (current !== undefined) {
        try {
          deps.fs.rmSync(current.folder, { recursive: true, force: true });
        } catch {
          // The process is exiting; the link expires by itself.
        }
      }
    });
    await sweep();
  };

  const showNow = async (page: { svg: string; expiresAt: string }): Promise<boolean> => {
    await removeNow();
    await start();
    if (!isPlainSvg(page.svg)) {
      return false;
    }
    const lifetime = Date.parse(page.expiresAt) - deps.now();
    if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > MAX_LIFETIME_MS) {
      return false;
    }
    let folder: string;
    try {
      folder = await deps.fs.mkdtemp(join(deps.tempRoot, QR_PAGE_PREFIX));
    } catch {
      return false;
    }
    const cancel = deps.schedule(() => {
      void serial(async () => {
        if (current?.folder === folder) {
          await removeNow();
        }
      });
    }, lifetime);
    current = { folder, cancel };
    const path = join(folder, QR_PAGE_FILE);
    try {
      await deps.fs.writeFile(path, qrPageHtml(page), { mode: 0o600, flag: 'wx' });
    } catch {
      await removeNow();
      return false;
    }
    const opened = await deps.open(path);
    if (!opened) {
      // The chat shows the QR code instead, so the page has no reader: remove it now.
      await removeNow();
    }
    return opened;
  };

  return {
    show: (page) => serial(() => showNow(page)),
    clear: () => serial(removeNow),
  };
}
