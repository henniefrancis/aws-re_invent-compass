import { describe, expect, test } from 'vitest';
import { createAppDataResolver, joinInFolder } from '../../src/passes/app-data.js';
import {
  createItineraryPage,
  PALETTE,
  VENUE_NOT_PUBLISHED,
} from '../../src/passes/itinerary-page.js';
import type { Itinerary } from '../../src/passes/models.js';
import { PassError } from '../../src/passes/redaction.js';
import { memoryFs } from './memory-fs.js';
import { WINDOW } from './support.js';

// Tests for Itinerary_Page (boarding-passes, S4, Requirement 7). The page is a fixed template
// over the itinerary, so structure is proven by a snapshot plus targeted assertions rather
// than by properties. Reflow at 320 pixels needs a real layout engine; here it is asserted
// structurally (no fixed widths), and a Playwright check belongs to the site stream.

const appData = createAppDataResolver({
  platform: 'linux',
  env: { XDG_DATA_HOME: '/home/ada/.local/share' },
  homeDir: '/home/ada',
});

function page() {
  const fs = memoryFs();
  return { fs, page: createItineraryPage({ fs, appData }) };
}

const SAMPLE: Itinerary = {
  commitments: [
    {
      commitment: {
        kind: 'reservedSession',
        sessionId: 'sess-0001',
        title: 'Build on AWS, the boarding pass pattern',
        venue: 'Venetian',
        startsAt: '2026-12-01T10:30:00-08:00',
        endsAt: '2026-12-01T11:30:00-08:00',
      },
    },
    {
      commitment: {
        kind: 'personalTime',
        title: 'Lunch and a walk',
        location: 'Lounge',
        startsAt: '2026-12-01T12:00:00-08:00',
        endsAt: '2026-12-01T13:00:00-08:00',
      },
    },
    {
      commitment: {
        kind: 'reservedSession',
        sessionId: 'sess-0002',
        title: 'Networking deep dive',
        venue: '',
        startsAt: '2026-12-01T22:00:00Z',
        endsAt: '2026-12-01T23:00:00Z',
      },
      walkMinutes: 12,
    },
    {
      commitment: {
        kind: 'reservedSession',
        sessionId: 'sess-0003',
        title: 'Day two keynote overflow',
        venue: 'MGM Grand',
        startsAt: '2026-12-02T09:00:00-08:00',
        endsAt: '2026-12-02T10:00:00-08:00',
      },
    },
  ],
};

/** The heading levels in document order. */
function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])[ >]/g)].map((match) => Number(match[1]));
}

/** WCAG 2.2 relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe('Feature: boarding-passes, itinerary page snapshot and content (Requirement 9.1)', () => {
  test('the rendered HTML matches its snapshot', () => {
    expect(page().page.render(SAMPLE, WINDOW)).toMatchSnapshot();
  });

  test('the page is one self-contained document with inlined CSS', () => {
    const html = page().page.render(SAMPLE, WINDOW);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<html/g)).toHaveLength(1);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  test('there is no script element and no inline event-handler attribute', () => {
    const html = page().page.render(SAMPLE, WINDOW);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  test('there is no external resource reference and no network request', () => {
    const html = page().page.render(SAMPLE, WINDOW);
    expect(html).not.toMatch(/https?:/i);
    expect(html).not.toMatch(/(^|[\s"'(=])\/\//);
    expect(html).not.toMatch(/\b(src|href|action|poster|data)\s*=/i);
    expect(html).not.toMatch(
      /url\(|@import|<link|<img|<iframe|<form|<object|<embed|<audio|<video/i,
    );
    expect(html).toContain("default-src 'none'");
  });

  test('an empty or missing venue renders the gate as exactly Venue not published', () => {
    const html = page().page.render(SAMPLE, WINDOW);
    expect(VENUE_NOT_PUBLISHED).toBe('Venue not published');
    expect(html).toContain('<dt>Gate</dt><dd>Venue not published</dd>');
    for (const venue of [undefined, '', '   ']) {
      const only: Itinerary = {
        commitments: [
          {
            commitment: {
              kind: 'reservedSession',
              sessionId: 's1',
              title: 'No venue yet',
              venue,
              startsAt: '2026-12-01T10:30:00-08:00',
              endsAt: '2026-12-01T11:30:00-08:00',
            },
          },
        ],
      };
      expect(page().page.render(only, WINDOW)).toContain('<dd>Venue not published</dd>');
    }
    expect(html).toContain('<dt>Gate</dt><dd>Venetian</dd>');
  });
});

describe('Feature: boarding-passes, itinerary page structure and accessibility', () => {
  const html = page().page.render(SAMPLE, WINDOW);

  test('it has a document language, a non-empty title, a viewport meta tag and a charset', () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta charset="utf-8">');
  });

  test('it has exactly one h1 and a heading outline that skips no level', () => {
    const levels = headingLevels(html);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((level, index) => {
      if (index > 0) {
        expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 0) + 1);
      }
    });
    expect(levels).toEqual([1, 2, 3, 3, 3, 2, 3]);
  });

  test('the itinerary is list markup with a description list per item', () => {
    expect(html.match(/<ol>/g)).toHaveLength(2);
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain('<dl>');
    expect(html).toContain('<time datetime="2026-12-01T10:30:00-08:00">10:30</time>');
  });

  test('the event timezone is stated once and every time is in event local time', () => {
    expect(html.match(/America\/Los_Angeles/g)).toHaveLength(1);
    // The UTC session at 22:00Z is 14:00 in Los Angeles, and boarding closes at 13:50.
    expect(html).toContain('<time datetime="2026-12-01T22:00:00Z">14:00</time>');
    expect(html).toContain('<dt>Boarding closes</dt><dd>13:50 (10 minutes before the start)</dd>');
    expect(html).toContain('<dt>Boarding closes</dt><dd>10:20 (10 minutes before the start)</dd>');
    expect(html).toContain("12 minutes' walk from your previous stop");
  });

  test('items are grouped by local day and sorted by start time', () => {
    const shuffled: Itinerary = { commitments: [...SAMPLE.commitments].reverse() };
    expect(page().page.render(shuffled, WINDOW)).toBe(html);
    expect(html).toContain('<h2>Tuesday 1 December 2026</h2>');
    expect(html).toContain('<h2>Wednesday 2 December 2026</h2>');
  });

  test('the layout reflows: no fixed width above 320 pixels and no horizontal scroll rule', () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(css.length).toBeGreaterThan(0);
    for (const match of css.matchAll(/(?<![a-z-])(?:min-)?width\s*:\s*([\d.]+)px/gi)) {
      expect(Number(match[1])).toBeLessThanOrEqual(320);
    }
    expect(css).not.toMatch(/overflow-x\s*:\s*(scroll|auto)/i);
    expect(css).not.toMatch(/white-space\s*:\s*nowrap/i);
    expect(css).toContain('overflow-wrap:anywhere');
    expect(css).toContain('max-width:40rem');
  });

  test('a layover shows its location only when it has one, and a blank title falls back', () => {
    const itinerary: Itinerary = {
      commitments: [
        {
          commitment: {
            kind: 'personalTime',
            title: ' ',
            startsAt: '2026-12-01T10:00:00-08:00',
            endsAt: '2026-12-01T11:00:00-08:00',
          },
        },
        {
          commitment: {
            kind: 'reservedSession',
            sessionId: 's1',
            startsAt: '2026-12-01T12:00:00-08:00',
            endsAt: '2026-12-01T13:00:00-08:00',
          },
        },
        {
          commitment: {
            kind: 'personalTime',
            title: 'Coffee',
            location: '  ',
            startsAt: '2026-12-01T14:00:00-08:00',
            endsAt: '2026-12-01T15:00:00-08:00',
          },
        },
      ],
    };
    const out = page().page.render(itinerary, WINDOW);
    expect(out).toContain('<h3>Layover</h3>');
    expect(out).toContain('<h3>Reserved session</h3>');
    expect(out).toContain('<h3>Coffee</h3>');
    expect(out).not.toContain('<dt>Location</dt>');
    expect(out.match(/\(layover\)/g)).toHaveLength(2);
    expect(html).toContain('<dt>Location</dt><dd>Lounge</dd>');
  });

  test('an invalid walk is left out and a valid one is rounded', () => {
    const withWalk = (walkMinutes: number): Itinerary => ({
      commitments: [{ ...(SAMPLE.commitments[0] as object), walkMinutes } as never],
    });
    expect(page().page.render(withWalk(Number.NaN), WINDOW)).not.toContain('walk from');
    expect(page().page.render(withWalk(500), WINDOW)).not.toContain('walk from');
    expect(page().page.render(withWalk(7.4), WINDOW)).toContain("7 minutes' walk");
  });

  test('an empty itinerary is a valid page with one heading and a note', () => {
    const out = page().page.render({ commitments: [] }, WINDOW);
    expect(headingLevels(out)).toEqual([1]);
    expect(out).toContain('Nothing is reserved yet.');
    expect(out).not.toContain('<ol>');
  });

  test('text from the schedule is escaped and cannot add markup', () => {
    const hostile = '<img src=x onerror=alert(1)> & "quotes" \'single\'';
    const out = page().page.render(
      {
        commitments: [
          {
            commitment: {
              kind: 'reservedSession',
              sessionId: 's1',
              title: hostile,
              venue: hostile,
              startsAt: '2026-12-01T10:30:00-08:00',
              endsAt: '2026-12-01T11:30:00-08:00',
            },
          },
        ],
      },
      WINDOW,
    );
    expect(out).not.toContain('<img');
    expect(out).toContain(
      '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot; &#39;single&#39;',
    );
  });
});

describe('Feature: boarding-passes, itinerary page palette contrast (Requirement 7.10)', () => {
  test('body text and muted text are at least 4.5 to 1 on the page background', () => {
    expect(contrast(PALETTE.text, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PALETTE.mutedText, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
  });

  test('borders are at least 3 to 1, and the contrast helper is sound', () => {
    expect(contrast(PALETTE.border, PALETTE.background)).toBeGreaterThanOrEqual(3);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.6);
  });
});

describe('Feature: boarding-passes, itinerary page write and failures', () => {
  test('write puts the page inside the app-data output folder with mode 0600', async () => {
    const { fs, page: itinerary } = page();
    const path = await itinerary.write(SAMPLE, WINDOW);
    const folder = joinInFolder(appData.resolve(), 'output');
    expect(path).toBe(joinInFolder(folder, 'itinerary.html'));
    expect(fs.dirs).toEqual([folder]);
    expect(fs.modes.get(path)).toBe(0o600);
    expect(fs.files.get(path)).toBe(itinerary.render(SAMPLE, WINDOW));
  });

  test('a filesystem failure is a fixed PassError that names no path', async () => {
    for (const operation of ['ensureDir', 'writeFile'] as const) {
      const { fs, page: itinerary } = page();
      fs.failing.add(operation);
      await expect(itinerary.write(SAMPLE, WINDOW)).rejects.toMatchObject({
        code: 'itinerary.write_failed',
        message: 'The itinerary page could not be written.',
      });
    }
  });

  test('a bad timezone or a bad instant is a PassError that echoes nothing', () => {
    const { page: itinerary } = page();
    let caught: unknown;
    try {
      itinerary.render(SAMPLE, { ...WINDOW, timezone: 'Not/AZone-secret' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PassError);
    expect((caught as PassError).code).toBe('itinerary.invalid_window');
    expect((caught as PassError).message).not.toContain('secret');

    const broken: Itinerary = {
      commitments: [
        {
          commitment: {
            kind: 'personalTime',
            title: 'x',
            startsAt: 'secret-time',
            endsAt: '2026-12-01T11:00:00-08:00',
          },
        },
      ],
    };
    expect(() => itinerary.render(broken, WINDOW)).toThrow(PassError);
  });
});
