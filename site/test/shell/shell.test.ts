import { describe, expect, test } from 'vitest';
import { COPIED_MESSAGE, COPY_FAILED_MESSAGE } from '../../src/lib/content/install';
import { copyText } from '../../src/lib/shell/copy';
import { shouldMoveFocus } from '../../src/lib/shell/focus';
import { pageTitle } from '../../src/lib/shell/title';

describe('shell helpers', () => {
  test('focus moves after every navigation except the first', () => {
    expect(shouldMoveFocus(0)).toBe(false);
    expect(shouldMoveFocus(1)).toBe(true);
    expect(shouldMoveFocus(7)).toBe(true);
  });

  test('titles read "<page> | re:Invent Compass"', () => {
    expect(pageTitle('Demo')).toBe('Demo | re:Invent Compass');
    expect(pageTitle(undefined)).toBe('re:Invent Compass');
    expect(pageTitle('')).toBe('re:Invent Compass');
  });

  test('copy reports Copied and passes the exact text to the clipboard', async () => {
    const written: string[] = [];
    const message = await copyText(
      {
        writeText: (text) => {
          written.push(text);
          return Promise.resolve();
        },
      },
      'npx reinvent-compass',
    );
    expect(message).toBe(COPIED_MESSAGE);
    expect(written).toEqual(['npx reinvent-compass']);
  });

  test('copy reports the failure text when the clipboard rejects, throws or is missing', async () => {
    expect(await copyText({ writeText: () => Promise.reject(new Error('no')) }, 'x')).toBe(
      COPY_FAILED_MESSAGE,
    );
    expect(
      await copyText(
        {
          writeText: () => {
            throw new Error('no');
          },
        },
        'x',
      ),
    ).toBe(COPY_FAILED_MESSAGE);
    expect(await copyText(undefined, 'x')).toBe(COPY_FAILED_MESSAGE);
  });
});
