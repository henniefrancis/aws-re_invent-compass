import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SITE_ROOT } from '../support/source-files';

const template = readFileSync(
  join(SITE_ROOT, 'src', 'app', 'pages', 'board', 'board-page.component.html'),
  'utf8',
);

describe('board page live region (tracker BM1)', () => {
  test('is visually hidden, so the message is on screen once and still announced once', () => {
    const region = /<p[^>]*aria-live="polite"[^>]*>/.exec(template)?.[0] ?? '';
    expect(region).toContain('role="status"');
    expect(region).toContain('visually-hidden');
    expect(template.match(/aria-live=/g)).toHaveLength(1);
  });
});
