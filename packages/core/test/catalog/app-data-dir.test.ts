import { posix, win32 } from 'node:path';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { APP_DATA_DIR_NAME, resolveAppDataDir } from '../../src/catalog/app-data-dir.js';

// Tests for app-data directory resolution (events-client, S1, tasks 13.1 and 13.2).

const winPathArb = fc.stringMatching(/^[A-Z]:\\[A-Za-z0-9 ]{1,12}(\\[A-Za-z0-9 ]{1,12}){0,2}$/);
const posixPathArb = fc.stringMatching(/^\/[a-z0-9]{1,8}(\/[a-z0-9]{1,8}){0,2}$/);

describe('Feature: events-client, Property 25: App-data directory resolves per platform', () => {
  // Validates: Requirements 14.1, 14.2, 14.3
  test('Windows uses %APPDATA% joined with reinvent-compass', () => {
    fc.assert(
      fc.property(winPathArb, winPathArb, (appData, home) => {
        expect(resolveAppDataDir({ APPDATA: appData }, home, 'win32')).toBe(
          win32.join(appData, 'reinvent-compass'),
        );
      }),
      { numRuns: 100 },
    );
  });

  test('Windows without %APPDATA% uses the standard roaming default under home', () => {
    for (const env of [{}, { APPDATA: '' }, { APPDATA: 'relative\\dir' }, { APPDATA: '..\\up' }]) {
      expect(resolveAppDataDir(env, 'C:\\Users\\Pat', 'win32')).toBe(
        'C:\\Users\\Pat\\AppData\\Roaming\\reinvent-compass',
      );
    }
  });

  test('macOS uses Application Support under home', () => {
    fc.assert(
      fc.property(posixPathArb, (home) => {
        expect(resolveAppDataDir({ XDG_DATA_HOME: '/ignored' }, home, 'darwin')).toBe(
          posix.join(home, 'Library', 'Application Support', 'reinvent-compass'),
        );
      }),
      { numRuns: 100 },
    );
  });

  test('Linux uses an absolute XDG_DATA_HOME, else ~/.local/share', () => {
    fc.assert(
      fc.property(posixPathArb, posixPathArb, (xdg, home) => {
        expect(resolveAppDataDir({ XDG_DATA_HOME: xdg }, home, 'linux')).toBe(
          posix.join(xdg, 'reinvent-compass'),
        );
        for (const env of [{}, { XDG_DATA_HOME: '' }, { XDG_DATA_HOME: 'relative/dir' }]) {
          expect(resolveAppDataDir(env, home, 'linux')).toBe(
            posix.join(home, '.local', 'share', 'reinvent-compass'),
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  test('the directory name is reinvent-compass', () => {
    expect(APP_DATA_DIR_NAME).toBe('reinvent-compass');
  });
});
