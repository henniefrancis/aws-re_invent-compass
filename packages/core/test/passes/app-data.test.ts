import { describe, expect, test } from 'vitest';
import { homedir } from 'node:os';
import {
  createAppDataResolver,
  createNodeAppDataResolver,
  joinInFolder,
} from '../../src/passes/app-data.js';

// Tests for the per-OS app-data folder (boarding-passes, S4, Requirement 3.2). Every case
// hands the resolver a fixed platform, environment and home directory, so the result never
// depends on the machine that runs the suite.

function resolveFor(platform: string, env: Record<string, string | undefined>, homeDir: string) {
  return createAppDataResolver({ platform, env, homeDir }).resolve();
}

describe('Feature: boarding-passes, per-OS App_Data_Folder resolution', () => {
  test('Windows uses APPDATA with the reinvent-compass suffix', () => {
    expect(
      resolveFor('win32', { APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' }, 'C:\\Users\\Ada'),
    ).toBe('C:\\Users\\Ada\\AppData\\Roaming\\reinvent-compass');
  });

  test('Windows tolerates a trailing separator and falls back to the home folder', () => {
    expect(resolveFor('win32', { APPDATA: 'D:\\Data\\' }, 'C:\\Users\\Ada')).toBe(
      'D:\\Data\\reinvent-compass',
    );
    expect(resolveFor('win32', {}, 'C:\\Users\\Ada')).toBe(
      'C:\\Users\\Ada\\AppData\\Local\\reinvent-compass',
    );
    expect(resolveFor('win32', { APPDATA: '' }, 'C:\\Users\\Ada')).toBe(
      'C:\\Users\\Ada\\AppData\\Local\\reinvent-compass',
    );
  });

  test('macOS uses Library/Application Support under the home folder', () => {
    expect(resolveFor('darwin', { XDG_DATA_HOME: '/ignored' }, '/Users/ada')).toBe(
      '/Users/ada/Library/Application Support/reinvent-compass',
    );
  });

  test('Linux uses XDG_DATA_HOME with the /reinvent-compass suffix', () => {
    expect(resolveFor('linux', { XDG_DATA_HOME: '/data/xdg' }, '/home/ada')).toBe(
      '/data/xdg/reinvent-compass',
    );
    expect(resolveFor('linux', { XDG_DATA_HOME: '/data/xdg/' }, '/home/ada')).toBe(
      '/data/xdg/reinvent-compass',
    );
  });

  test('Linux falls back to ~/.local/share when XDG_DATA_HOME is unset, empty or not absolute', () => {
    for (const env of [{}, { XDG_DATA_HOME: '' }, { XDG_DATA_HOME: 'relative/dir' }]) {
      expect(resolveFor('linux', env, '/home/ada')).toBe('/home/ada/.local/share/reinvent-compass');
    }
  });

  test('any other platform is treated like Linux', () => {
    expect(resolveFor('freebsd', { XDG_DATA_HOME: '/x' }, '/home/ada')).toBe('/x/reinvent-compass');
  });

  test('the Node resolver reads this process and agrees with the pure resolver', () => {
    expect(createNodeAppDataResolver().resolve()).toBe(
      resolveFor(process.platform, process.env, homedir()),
    );
  });
});

describe('Feature: boarding-passes, joinInFolder keeps the style of the root', () => {
  test('a drive-letter or backslash root joins with backslashes', () => {
    expect(joinInFolder('C:\\Users\\Ada\\reinvent-compass', 'output', 'reinvent.ics')).toBe(
      'C:\\Users\\Ada\\reinvent-compass\\output\\reinvent.ics',
    );
    expect(joinInFolder('C:/Users/Ada/reinvent-compass', 'a.json')).toBe(
      'C:\\Users\\Ada\\reinvent-compass\\a.json',
    );
    expect(joinInFolder('\\\\server\\share\\reinvent-compass', 'a.json')).toBe(
      '\\\\server\\share\\reinvent-compass\\a.json',
    );
  });

  test('a posix root joins with forward slashes', () => {
    expect(
      joinInFolder('/home/ada/.local/share/reinvent-compass', 'output', 'itinerary.html'),
    ).toBe('/home/ada/.local/share/reinvent-compass/output/itinerary.html');
  });
});
