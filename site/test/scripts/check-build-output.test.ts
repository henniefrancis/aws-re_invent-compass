import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  NOTICE_TEXT,
  expectedRouteFiles,
  findOutputIssues,
  runCli,
  runDefault,
  scanTags,
} from '../../scripts/check-build-output.mjs';

function page(body: string, head = '', lang = 'en'): string {
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>T</title><base href="/">${head}</head><body><h1 tabindex="-1">Title</h1>${body}<p>${NOTICE_TEXT}</p></body></html>`;
}

const options: { file: string; expectNoindex: boolean; requireContent?: boolean } = {
  file: 'index.html',
  expectNoindex: false,
};
const rules = (html: string, extra: Partial<typeof options> = {}): string[] =>
  findOutputIssues(html, { ...options, ...extra }).map((i) => i.rule);

describe('scanTags', () => {
  test('reads names, attribute forms and closing tags', () => {
    const tags = scanTags(`<a href="x" data-a='y' b=z c d =  "e">t</a>`);
    expect(tags).toEqual([
      {
        name: 'a',
        closing: false,
        attributes: [
          { name: 'href', value: 'x' },
          { name: 'data-a', value: 'y' },
          { name: 'b', value: 'z' },
          { name: 'c', value: null },
          { name: 'd', value: 'e' },
        ],
      },
      { name: 'a', closing: true, attributes: [] },
    ]);
  });

  test('skips comments, declarations and unterminated ones', () => {
    expect(scanTags('<!-- <b> --><!DOCTYPE html><?x?><i>')).toHaveLength(1);
    expect(scanTags('<i><!-- never closed <b>')).toHaveLength(1);
    expect(scanTags('<i><!DOCTYPE never closed <b>')).toHaveLength(1);
  });

  test('jumps over raw text elements and reads text that is not a tag', () => {
    const tags = scanTags('<script>if (a < b) { x("<u>") }</script><p>1 < 2</p>');
    expect(tags.map((t) => `${t.closing ? '/' : ''}${t.name}`)).toEqual([
      'script',
      '/script',
      'p',
      '/p',
    ]);
    expect(scanTags('<script>never closed <b>')).toHaveLength(1);
  });

  test('a tag whose quote never closes is read as text', () => {
    expect(scanTags('<a href="x>text')).toEqual([]);
  });
});

describe('findOutputIssues', () => {
  test('a clean page reports nothing', () => {
    expect(rules(page('<p>Hello</p><a href="https://example.invalid/x">out</a>'))).toEqual([]);
  });

  test('inline script, with src and json allowed', () => {
    expect(rules(page('<script>alert(1)</script>'))).toEqual(['inline-script']);
    expect(rules(page('<script type="text/javascript">1</script>'))).toEqual(['inline-script']);
    expect(rules(page('<script src="main.js" type="module"></script>'))).toEqual([]);
    expect(rules(page('<script id="s" type="application/json">{"a":1}</script>'))).toEqual([]);
    expect(rules(page('<script type=" Application/JSON ">{}</script>'))).toEqual([]);
  });

  test('event handler attributes', () => {
    expect(rules(page('<div onclick="x()">t</div>'))).toEqual(['event-handler']);
    expect(rules(page('<body ONLOAD=x>'))).toContain('event-handler');
  });

  test('javascript URLs in url attributes only', () => {
    expect(rules(page('<a href="javascript:void(0)">x</a>'))).toEqual(['javascript-url']);
    expect(rules(page('<a href="  JavaScript:x">x</a>'))).toEqual(['javascript-url']);
    expect(rules(page('<a title="javascript:x">x</a>'))).toEqual([]);
  });

  test('obfuscated javascript: URLs are found (QA L3)', () => {
    const tab = String.fromCharCode(9);
    const newline = String.fromCharCode(10);
    const forms = [
      'java' + tab + 'script:alert(1)',
      'java' + newline + 'script:alert(1)',
      tab + newline + ' javascript:alert(1)',
      '&#106;avascript:alert(1)',
      '&#x6A;avascript:alert(1)',
      '&#0000106avascript:alert(1)',
      'javascript&colon;alert(1)',
      'java&Tab;script:alert(1)',
      'java&NewLine;script&colon;alert(1)',
      'JaVaScRiPt:alert(1)',
    ];
    for (const value of forms) {
      expect(rules(page('<a href="' + value + '">x</a>')), value).toEqual(['javascript-url']);
    }
    expect(rules(page('<iframe src="&#106;avascript:1"></iframe>'))).toContain('javascript-url');
    expect(rules(page('<a href="&#999999999;x">x</a>'))).toEqual([]);
    expect(rules(page('<a href="/java script:x">x</a>'))).toEqual([]);
    expect(rules(page('<a href="javascripts.html">x</a>'))).toEqual([]);
  });

  test('meta refresh, other base hrefs, object, embed, iframe and svg use are refused (QA L3)', () => {
    expect(rules(page('', '<meta http-equiv="refresh" content="0;url=/x">'))).toEqual([
      'meta-refresh',
    ]);
    expect(rules(page('', '<meta http-equiv="Refresh" content="5">'))).toEqual(['meta-refresh']);
    expect(rules(page('', '<meta http-equiv="content-type" content="text/html">'))).toEqual([]);
    expect(rules(page('', '<base href="https://evil.invalid/">'))).toEqual(['base-href']);
    expect(rules(page('', '<base href="/x/">'))).toEqual(['base-href']);
    expect(rules(page('', '<base target="_blank">'))).toEqual(['base-href']);
    expect(rules(page('<object data="x.swf"></object>'))).toEqual(['object-embed']);
    expect(rules(page('<embed src="x.swf">'))).toEqual(['object-embed']);
    expect(rules(page('<iframe srcdoc="<p>x</p>"></iframe>'))).toEqual(['iframe']);
    expect(rules(page('<iframe src="/x"></iframe>'))).toEqual(['iframe']);
    expect(rules(page('<svg><use href="https://evil.invalid/s.svg#a"></use></svg>'))).toEqual([
      'svg-use-href',
    ]);
    expect(rules(page('<svg><use xlink:href="/sprite.svg#a"></use></svg>'))).toEqual([
      'svg-use-href',
    ]);
    expect(rules(page('<svg><use href="#local"></use></svg>'))).toEqual([]);
    expect(rules(page('<svg><use></use></svg>'))).toEqual([]);
  });

  test('style elements and style attributes', () => {
    expect(rules(page('<style>a{}</style>'))).toEqual(['style-element']);
    expect(rules(page('<p style="color:red">x</p>'))).toEqual(['style-attribute']);
  });

  test('cross-origin resources, but not links the user follows', () => {
    expect(rules(page('<img src="https://evil.invalid/a.png" alt="">'))).toEqual([
      'cross-origin-resource',
    ]);
    expect(rules(page('<img src="//evil.invalid/a.png" alt="">'))).toEqual([
      'cross-origin-resource',
    ]);
    expect(rules(page('<img srcset="http://evil.invalid/a.png 1x" alt="">'))).toEqual([
      'cross-origin-resource',
    ]);
    expect(rules(page('', '<link rel="stylesheet" href="https://evil.invalid/a.css">'))).toEqual([
      'cross-origin-resource',
    ]);
    expect(
      rules(page('<img src="artwork/a.svg" alt="">', '<link rel="icon" href="artwork/f.svg">')),
    ).toEqual([]);
    expect(rules(page('<a href="https://example.invalid/">x</a>'))).toEqual([]);
  });

  test('exactly one h1, lang en and the Notice', () => {
    expect(rules(page('<h1>Two</h1>'))).toEqual(['h1-count']);
    expect(rules(page('', '', 'fr'))).toEqual(['html-lang']);
    expect(rules('<html lang="en"><body><h1>x</h1></body></html>')).toEqual(['notice-missing']);
    expect(rules(`<html lang="en"><body><h1>x</h1><!-- ${NOTICE_TEXT} --></body></html>`)).toEqual([
      'notice-missing',
    ]);
  });

  test('a Notice hidden inside nested comment markers is still missing (CodeQL alert 2)', () => {
    // One pass would remove the inner comment and leave `<!-- Notice -->` behind.
    const nested = `<html lang="en"><body><h1>x</h1><!-<!-- x -->- ${NOTICE_TEXT} --></body></html>`;
    expect(rules(nested)).toEqual(['notice-missing']);
  });

  test('noindex belongs on the board page only', () => {
    const noindex = '<meta name="robots" content="noindex">';
    expect(rules(page('', noindex), { expectNoindex: true })).toEqual([]);
    expect(rules(page(''), { expectNoindex: true })).toEqual(['noindex-missing']);
    expect(rules(page('', noindex))).toEqual(['noindex-unexpected']);
    expect(rules(page('', '<meta name="robots" content="index">'))).toEqual([]);
    expect(rules(page('<button disabled>x</button>', '<meta name="robots">'))).toEqual([]);
  });

  test('a file without required content only gets the CSP rules', () => {
    expect(rules('<html><body></body></html>', { requireContent: false })).toEqual([]);
    expect(
      rules('<html><body><script>1</script></body></html>', { requireContent: false }),
    ).toEqual(['inline-script']);
  });

  test('issues name the file and the rule', () => {
    expect(
      findOutputIssues(page('<style></style>'), { file: 'demo/index.html', expectNoindex: false }),
    ).toEqual([
      { rule: 'style-element', file: 'demo/index.html', detail: 'a style element is present' },
    ]);
  });
});

describe('Property 18: The build output check finds every CSP-breaking construct', () => {
  // Feature: showcase-site, Property 18: The build output check finds every CSP-breaking construct
  const word = fc.stringMatching(/^[a-z]{1,8}$/);
  const harmless = fc.oneof(
    word.map((w) => `<p>${w}</p>`),
    word.map((w) => `<a href="https://example.invalid/${w}">${w}</a>`),
    word.map((w) => `<!-- <script>alert(1)</script> onclick="x" style="y" ${w} -->`),
    word.map((w) => `<div title="onclick=1 style=2 javascript:x <script> ${w}">${w}</div>`),
    word.map((w) => `<script type="application/json">{"k":"<style>${w}"}</script>`),
    word.map((w) => `<img src="artwork/${w}.svg" alt="${w}" width="1" height="1">`),
    word.map((w) => `<svg><use href="#${w}"></use></svg>`),
    word.map((w) => `<div title="javascript:x &#106; http-equiv=refresh <iframe> ${w}">${w}</div>`),
    word.map((w) => `<textarea>&lt;script&gt;${w}</textarea>`),
  );
  const violations: readonly (readonly [string, string])[] = [
    ['inline-script', '<script>alert(1)</script>'],
    ['event-handler', '<div onclick="x()">t</div>'],
    ['javascript-url', '<a href="javascript:void(0)">t</a>'],
    ['style-element', '<style>a{color:red}</style>'],
    ['style-attribute', '<p style="color:red">t</p>'],
    ['cross-origin-resource', '<img src="https://evil.invalid/a.png" alt="">'],
    ['javascript-url', '<a href="&#106;avascript:alert(1)">t</a>'],
    ['javascript-url', '<a href="java&#x09;script&colon;alert(1)">t</a>'],
    ['javascript-url', '<a href="java' + String.fromCharCode(9) + 'script:alert(1)">t</a>'],
    ['meta-refresh', '<meta http-equiv="refresh" content="0;url=/x">'],
    ['base-href', '<base href="https://evil.invalid/">'],
    ['object-embed', '<object data="x.swf"></object>'],
    ['object-embed', '<embed src="x.swf">'],
    ['iframe', '<iframe srcdoc="<p>x</p>"></iframe>'],
    ['svg-use-href', '<svg><use href="https://evil.invalid/s.svg#a"></use></svg>'],
  ];

  test('a clean document reports nothing', () => {
    fc.assert(
      fc.property(fc.array(harmless, { maxLength: 8 }), (segments) => {
        expect(findOutputIssues(page(segments.join('')), options)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  test('one injected violation at any position reports exactly that rule', () => {
    fc.assert(
      fc.property(
        fc.array(harmless, { maxLength: 8 }),
        fc.nat(8),
        fc.constantFrom(...violations),
        (segments, position, [rule, markup]) => {
          const at = Math.min(position, segments.length);
          const body = [...segments.slice(0, at), markup, ...segments.slice(at)].join('');
          const issues = findOutputIssues(page(body), options);
          expect(issues.map((i) => i.rule)).toEqual([rule]);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('runCli', () => {
  const routes = expectedRouteFiles();
  const board = (html: string): string =>
    html.replace('</head>', '<meta name="robots" content="noindex"></head>');
  const files = (overrides: Record<string, string> = {}): Record<string, string> => ({
    ...Object.fromEntries(
      routes.map((r) => [r, r === 'board/index.html' ? board(page('')) : page('')]),
    ),
    'index.csr.html': '<html><body><app-root></app-root></body></html>',
    'main.js': 'console.log(1)',
    ...overrides,
  });
  const run = (map: Record<string, string>) =>
    runCli({
      distDir: 'dist',
      listFiles: () => Promise.resolve(Object.keys(map)),
      readFile: (path: string) =>
        Promise.resolve(map[path.split(/[\\/]/).slice(1).join('/')] ?? ''),
    });

  test('lists the six prerendered route files', () => {
    expect(routes).toEqual([
      'index.html',
      'demo/index.html',
      'install/index.html',
      'privacy/index.html',
      'about/index.html',
      'board/index.html',
    ]);
  });

  test('passes a clean build', async () => {
    const result = await run(files());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok: 7 HTML files');
  });

  test('fails and names the file and the rule', async () => {
    const result = await run(files({ 'demo/index.html': page('<script>1</script>') }));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('demo/index.html: inline-script');
  });

  test('fails when a route file is missing', async () => {
    const map = files();
    delete map['privacy/index.html'];
    const result = await run(map);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('privacy/index.html: missing-route');
  });

  test('scans the csr fallback for CSP rules only', async () => {
    const result = await run(
      files({ 'index.csr.html': '<html><body><div style="x"></div></body></html>' }),
    );
    expect(result.stderr).toContain('index.csr.html: style-attribute');
  });

  test('the default run reads a real folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'site-output-'));
    try {
      for (const route of routes) {
        await mkdir(join(dir, route, '..'), { recursive: true });
        await writeFile(
          join(dir, route),
          route === 'board/index.html' ? board(page('')) : page(''),
          'utf8',
        );
      }
      expect((await runDefault(dir)).code).toBe(0);
      await writeFile(join(dir, 'demo/index.html'), page('<style></style>'), 'utf8');
      expect((await runDefault(dir)).code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
