// Build_Output_Check (showcase-site, Component 17).
//
// Reads every HTML file of the static build and fails the build when one of them could break
// the Required_CSP or the site rules. It uses a small tag and attribute scanner that is aware
// of comments, quoted attribute values and raw text elements, so text that only looks like a
// violation is not reported. No dependency: Node builtins only.
//
// Run from site/ after the build:  node scripts/check-build-output.mjs

import { readdir, readFile as readFileFs } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { maybeRunCli } from './cli.mjs';

/** The exact Notice sentence from README.md. The footer of every page must carry it. */
export const NOTICE_TEXT =
  're:Invent Compass is an independent community project and is not affiliated with, endorsed by, or sponsored by Amazon Web Services.';

/** The prerendered route files, relative to the browser output folder. */
export function expectedRouteFiles() {
  return [
    'index.html',
    'demo/index.html',
    'install/index.html',
    'privacy/index.html',
    'board/index.html',
  ];
}

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'data',
  'poster',
  'xlink:href',
]);

// Sticky patterns, tried in this order at each "<". An unterminated comment or declaration
// runs to the end of the text. A tag whose quotes never close does not match and is read as
// plain text.
const COMMENT = /<!--[\s\S]*?(?:-->|$)/y;
const DECLARATION = /<[!?][^>]*(?:>|$)/y;
const TAG = /<(\/?)([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/y;
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*)))?/g;

/**
 * @typedef {{ name: string, value: string | null }} Attribute
 * @typedef {{ name: string, closing: boolean, attributes: Attribute[] }} Tag
 */

/**
 * Match a sticky pattern at one position.
 * @param {RegExp} pattern
 * @param {string} text
 * @param {number} index
 */
function matchAt(pattern, text, index) {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

/**
 * Scan HTML into tags. Comments and declarations are skipped. The content of a raw text
 * element (script, style, textarea, title) is jumped over and never scanned.
 *
 * @param {string} html
 * @returns {Tag[]}
 */
export function scanTags(html) {
  /** @type {Tag[]} */
  const tags = [];
  const lower = html.toLowerCase();
  let i = html.indexOf('<');
  while (i >= 0) {
    let next = i + 1;
    const skipped = matchAt(COMMENT, html, i) ?? matchAt(DECLARATION, html, i);
    const found = skipped === null ? matchAt(TAG, html, i) : null;
    if (skipped !== null) {
      next = i + skipped[0].length;
    } else if (found !== null) {
      const name = found[2].toLowerCase();
      const closing = found[1] === '/';
      const attributes = [...found[3].matchAll(ATTRIBUTE)].map((m) => ({
        name: m[1].toLowerCase(),
        value: m[2] ?? m[3] ?? m[4] ?? null,
      }));
      tags.push({ name, closing, attributes });
      next = i + found[0].length;
      if (!closing && RAW_TEXT_ELEMENTS.has(name)) {
        const end = lower.indexOf(`</${name}`, next);
        next = end < 0 ? html.length : end;
      }
    }
    i = html.indexOf('<', next);
  }
  return tags;
}

/** @param {Attribute[]} attributes @param {string} name @returns {string | null | undefined} */
function attr(attributes, name) {
  return attributes.find((a) => a.name === name)?.value;
}

const NAMED_REFERENCES = { colon: ':', tab: '\t', newline: '\n' };

/**
 * An attribute value as a browser reads it as a URL: character references decoded (numeric in
 * decimal or hex, and the named ones that can build a scheme), tabs and line breaks removed
 * wherever they are, and leading control characters and spaces dropped.
 *
 * @param {string} value
 */
export function urlAsBrowserReadsIt(value) {
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, digits) => codePoint(parseInt(digits, 10)))
    .replace(/&(colon|tab|newline);/gi, (_, name) => NAMED_REFERENCES[name.toLowerCase()]);
  return decoded.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '');
}

/** The character of a code point, or an empty string when it is not a valid one. @param {number} code */
function codePoint(code) {
  return code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** True for an absolute or protocol relative URL. @param {string} value */
function isCrossOrigin(value) {
  return /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

/**
 * Every CSP or site rule a prerendered HTML document breaks.
 *
 * @param {string} html
 * @param {{ file: string, expectNoindex: boolean, requireContent?: boolean }} options
 * @returns {{ rule: string, file: string, detail: string }[]}
 */
export function findOutputIssues(html, { file, expectNoindex, requireContent = true }) {
  /** @type {{ rule: string, file: string, detail: string }[]} */
  const issues = [];
  const add = (rule, detail) => issues.push({ rule, file, detail });
  const tags = scanTags(html).filter((tag) => !tag.closing);
  let h1Count = 0;
  let noindex = false;
  let langOk = false;

  for (const tag of tags) {
    if (tag.name === 'script') {
      const src = attr(tag.attributes, 'src');
      const type = attr(tag.attributes, 'type');
      if (src === undefined && String(type).trim().toLowerCase() !== 'application/json') {
        add('inline-script', 'a script element has no src and is not application/json');
      }
    }
    if (tag.name === 'style') {
      add('style-element', 'a style element is present');
    }
    if (tag.name === 'h1') {
      h1Count += 1;
    }
    if (
      tag.name === 'meta' &&
      attr(tag.attributes, 'http-equiv')?.trim().toLowerCase() === 'refresh'
    ) {
      add('meta-refresh', 'a meta refresh can redirect the page');
    }
    if (tag.name === 'base' && attr(tag.attributes, 'href') !== '/') {
      add('base-href', 'the base element must have href="/"');
    }
    if (tag.name === 'object' || tag.name === 'embed') {
      add('object-embed', `an ${tag.name} element is present`);
    }
    if (tag.name === 'iframe') {
      add('iframe', 'an iframe element is present');
    }
    if (
      tag.name === 'use' &&
      !(attr(tag.attributes, 'href') ?? attr(tag.attributes, 'xlink:href') ?? '#').startsWith('#')
    ) {
      add('svg-use-href', 'an svg use element refers to something outside the page');
    }
    if (tag.name === 'html' && attr(tag.attributes, 'lang') === 'en') {
      langOk = true;
    }
    if (
      tag.name === 'meta' &&
      attr(tag.attributes, 'name')?.toLowerCase() === 'robots' &&
      /noindex/i.test(attr(tag.attributes, 'content') ?? '')
    ) {
      noindex = true;
    }
    for (const attribute of tag.attributes) {
      const value = attribute.value ?? '';
      if (attribute.name.startsWith('on')) {
        add('event-handler', `attribute ${attribute.name} on <${tag.name}>`);
      }
      if (attribute.name === 'style') {
        add('style-attribute', `style attribute on <${tag.name}>`);
      }
      if (URL_ATTRIBUTES.has(attribute.name) && /^javascript:/i.test(urlAsBrowserReadsIt(value))) {
        add('javascript-url', `javascript: URL in ${attribute.name} on <${tag.name}>`);
      }
      const loadsResource =
        attribute.name === 'src' ||
        (attribute.name === 'href' && tag.name === 'link') ||
        attribute.name === 'srcset';
      if (loadsResource && isCrossOrigin(value)) {
        add(
          'cross-origin-resource',
          `${attribute.name} on <${tag.name}> loads from another origin`,
        );
      }
    }
  }

  if (requireContent) {
    if (h1Count !== 1) {
      add('h1-count', `expected exactly one h1, found ${String(h1Count)}`);
    }
    if (!langOk) {
      add('html-lang', 'the html element must have lang="en"');
    }
    // Repeat until stable, so nested or overlapping markers cannot leave a comment behind.
    let withoutComments = html;
    let previous;
    do {
      previous = withoutComments;
      withoutComments = previous.replace(/<!--[\s\S]*?-->/g, '');
    } while (withoutComments !== previous);
    if (!withoutComments.includes(NOTICE_TEXT)) {
      add('notice-missing', 'the Notice text is not on the page');
    }
    if (expectNoindex && !noindex) {
      add('noindex-missing', 'the board page must carry meta robots noindex');
    }
    if (!expectNoindex && noindex) {
      add('noindex-unexpected', 'only the board page may carry meta robots noindex');
    }
  }
  return issues;
}

/**
 * Check every HTML file under the browser output folder.
 *
 * @param {{ distDir: string, readFile: (path: string) => Promise<string>, listFiles: (dir: string) => Promise<string[]> }} deps
 *   listFiles returns the paths of every file under dir, relative to dir, with forward slashes.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function runCli({ distDir, readFile, listFiles }) {
  const files = await listFiles(distDir);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  const routes = expectedRouteFiles();
  /** @type {{ rule: string, file: string, detail: string }[]} */
  const issues = [];
  for (const route of routes) {
    if (!htmlFiles.includes(route)) {
      issues.push({
        rule: 'missing-route',
        file: route,
        detail: 'the prerendered file does not exist',
      });
    }
  }
  for (const file of htmlFiles) {
    const html = await readFile(join(distDir, file));
    issues.push(
      ...findOutputIssues(html, {
        file,
        expectNoindex: file === 'board/index.html',
        requireContent: routes.includes(file),
      }),
    );
  }
  if (issues.length > 0) {
    const lines = issues.map((i) => `${i.file}: ${i.rule}: ${i.detail}`);
    return { code: 1, stdout: '', stderr: `build output check failed\n${lines.join('\n')}\n` };
  }
  return {
    code: 0,
    stdout: `build output check ok: ${String(htmlFiles.length)} HTML files\n`,
    stderr: '',
  };
}

/** Every file under a folder, relative to it, with forward slashes. @param {string} dir @returns {Promise<string[]>} */
async function listFilesFs(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

const DEFAULT_DIST = join(import.meta.dirname, '..', 'dist', 'site', 'browser');

/** The default run: the Angular browser output folder next to this scripts folder. */
export async function runDefault(distDir = DEFAULT_DIST) {
  return runCli({
    distDir,
    readFile: (path) => readFileFs(path, 'utf8'),
    listFiles: listFilesFs,
  });
}

await maybeRunCli({ runCli: runDefault, argv1: process.argv[1], metaUrl: import.meta.url });
