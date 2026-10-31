import { describe, expect, test } from 'vitest';
import { listFiles, stripNonCode, type SourceFile } from '../support/source-files';

// Static source checks (showcase-site design, "Static source checks").
//
// Each rule scans the files under src that exist now. A file that does not exist yet is
// skipped by the scan, never by the rule: the rule applies to it the moment it appears.

const ts = (dir: string): readonly SourceFile[] => listFiles(dir, ['.ts']);
const html = (dir: string): readonly SourceFile[] => listFiles(dir, ['.html']);
const css = (dir: string): readonly SourceFile[] => listFiles(dir, ['.css']);

const srcTs = ts('src');
const srcHtml = html('src');
const appTs = ts('src/app');
const libTs = ts('src/lib');
const demoLibTs = ts('src/lib/demo');

/** Files whose code (comments and strings removed) matches the pattern, as "path:line". */
function codeHits(files: readonly SourceFile[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const code = stripNonCode(file.text);
    code.split('\n').forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push(`${file.path}:${String(index + 1)}`);
      }
    });
  }
  return hits;
}

/** Files whose raw text matches the pattern, as "path:line". */
function rawHits(files: readonly SourceFile[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    file.text.split('\n').forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push(`${file.path}:${String(index + 1)}`);
      }
    });
  }
  return hits;
}

describe('no storage, cookies, service workers, beacons or console output', () => {
  const banned =
    /\b(localStorage|sessionStorage|indexedDB|caches|serviceWorker|sendBeacon)\b|document\s*\.\s*cookie|\bconsole\s*\./;
  test('site source uses none of the banned browser APIs', () => {
    expect(codeHits(srcTs, banned)).toEqual([]);
  });
  test('site templates use none of the banned browser APIs', () => {
    expect(rawHits(srcHtml, banned)).toEqual([]);
  });
});

describe('no code that bypasses the content security policy', () => {
  test('no innerHTML, outerHTML, insertAdjacentHTML, document.write or sanitiser bypass', () => {
    const banned =
      /\b(innerHTML|outerHTML|insertAdjacentHTML|bypassSecurityTrust\w*)\b|document\s*\.\s*write\b/;
    expect(codeHits(srcTs, banned)).toEqual([]);
    expect(rawHits(srcHtml, banned)).toEqual([]);
  });
  test('no eval, new Function, or a string argument to a timer', () => {
    const banned = /\beval\s*\(|new\s+Function\b|\bset(Timeout|Interval)\s*\(\s*['"`]/;
    // Strings are kept in this scan, because the string argument is the violation.
    const hits: string[] = [];
    for (const file of srcTs) {
      const withoutComments = file.text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''));
      withoutComments.forEach((line, index) => {
        if (banned.test(line)) {
          hits.push(`${file.path}:${String(index + 1)}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('no component styles and no inline style', () => {
  test('components declare no styles or styleUrl', () => {
    expect(codeHits(appTs, /\b(styles|styleUrl|styleUrls)\s*:/)).toEqual([]);
  });
  test('templates have no style attribute and no style binding', () => {
    expect(rawHits(srcHtml, /\bstyle\s*=|\[\s*style\b|\[\s*ngStyle\b|\bngStyle\b/)).toEqual([]);
  });
  test('component code does not set styles through the DOM', () => {
    expect(codeHits(appTs, /\.style\b|\bsetAttribute\s*\(\s*['"]style['"]/)).toEqual([]);
  });
});

describe('framework rules', () => {
  test('no NgModule anywhere in src', () => {
    expect(rawHits(srcTs, /\bNgModule\b/)).toEqual([]);
  });
  test('no zone.js import or reference', () => {
    expect(rawHits(srcTs, /zone\.js/)).toEqual([]);
  });
});

describe('module boundaries', () => {
  test('@compass/core is imported only as @compass/core/rules and only in rules-port.ts', () => {
    const offenders: string[] = [];
    for (const file of srcTs) {
      const specifiers = [...file.text.matchAll(/from\s+['"](@compass\/core[^'"]*)['"]/g)].map(
        (m) => m[1],
      );
      const isPort = file.path === 'src/lib/demo/rules-port.ts';
      for (const specifier of specifiers) {
        if (!isPort || specifier !== '@compass/core/rules') {
          offenders.push(`${file.path}: ${String(specifier)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
  test('fetch( appears only in handoff-client.ts', () => {
    const others = srcTs.filter((f) => f.path !== 'src/lib/board/handoff-client.ts');
    expect(codeHits(others, /\bfetch\s*\(/)).toEqual([]);
  });
  test('absolute http URLs appear only in links.ts and handoff-view.ts', () => {
    const allowed = new Set(['src/lib/content/links.ts', 'src/lib/board/handoff-view.ts']);
    const others = [...srcTs, ...srcHtml, ...css('src')].filter((f) => !allowed.has(f.path));
    const hits: string[] = [];
    for (const file of others) {
      const text = file.path.endsWith('.ts') ? stripCommentsKeepStrings(file.text) : file.text;
      text.split('\n').forEach((line, index) => {
        if (/https?:\/\//.test(line)) {
          hits.push(`${file.path}:${String(index + 1)}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('no clock in the demo logic', () => {
  test('Date.now and new Date( are not used under src/lib/demo', () => {
    expect(codeHits(demoLibTs, /\bDate\s*\.\s*now\b|new\s+Date\b/)).toEqual([]);
  });
});

describe('components hold no decisions', () => {
  test('no fetch(, switch (, JSON.parse or regular expression literal under src/app', () => {
    expect(codeHits(appTs, /\bfetch\s*\(|\bswitch\s*\(|\bJSON\s*\.\s*parse\b/)).toEqual([]);
    expect(codeHits(appTs, /(^|[=(,:[!&|?{};]|\breturn)\s*\/(?![/*])[^/\n]+\/[a-z]*/)).toEqual([]);
  });
});

describe('Site_Logic is free of Angular imports', () => {
  test('files under src/lib import nothing from @angular', () => {
    expect(rawHits(libTs, /from\s+['"]@angular\//)).toEqual([]);
  });
});

/** Source text with comments removed and string contents kept. */
function stripCommentsKeepStrings(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

describe('artwork', () => {
  const publicFiles = listFiles('public', ['']);
  const manifest = listFiles('.', ['ARTWORK.md']).find((f) => f.path === 'ARTWORK.md')?.text ?? '';

  test('every file in public is listed in ARTWORK.md', () => {
    expect(publicFiles.length).toBeGreaterThan(0);
    for (const file of publicFiles) {
      expect(manifest, file.path).toContain(`\`${file.path}\``);
    }
  });

  // The Creator page's owner-supplied images are the only raster files (tasks 34 and 35): the
  // photo, which shows the AWS Community Builder logo, and the five link images. The owner may
  // use these marks, so the text checks skip them.
  const OWNER_IMAGES = new Set([
    'public/artwork/hennie-francis.webp',
    'public/artwork/connect-website.webp',
    'public/artwork/connect-linkedin.webp',
    'public/artwork/connect-github.webp',
    'public/artwork/connect-awscommza.webp',
    'public/artwork/connect-builder-center.webp',
  ]);

  test('public holds only svg, txt and ico files, plus the owner images', () => {
    expect(publicFiles.filter((f) => OWNER_IMAGES.has(f.path))).toHaveLength(OWNER_IMAGES.size);
    for (const file of publicFiles.filter((f) => !OWNER_IMAGES.has(f.path))) {
      expect(file.path, file.path).toMatch(/\.(svg|txt|ico)$/);
    }
  });

  // The official Apple and Google badges are the one exception for their own names (task 29).
  const VENDOR_BADGES = new Set([
    'public/artwork/apple-wallet.svg',
    'public/artwork/google-wallet.svg',
  ]);

  test('no text artwork names an AWS mark, and only the vendor badges name Apple or Google', () => {
    expect(publicFiles.filter((f) => VENDOR_BADGES.has(f.path))).toHaveLength(2);
    for (const file of publicFiles.filter((f) => !OWNER_IMAGES.has(f.path))) {
      const text = file.text.toLowerCase();
      expect(text, file.path).not.toMatch(/aws|amazon/);
      if (!VENDOR_BADGES.has(file.path)) {
        expect(text, file.path).not.toMatch(/apple|google/);
      }
    }
  });
});
