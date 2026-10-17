// The per-OS app-data folder for the pass side (boarding-passes, S4, Requirement 3).
//
// Personal data stays on the attendee's machine, in a folder named reinvent-compass under
// the platform's per-user data location: %APPDATA% on Windows, ~/Library/Application
// Support on macOS, and $XDG_DATA_HOME on Linux (falling back to ~/.local/share, the XDG
// default). resolve is pure given the environment it is handed, so tests pass fixed
// values instead of reading the real environment.
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import type { AppDataResolver } from './interfaces.js';

/** The folder name appended to the platform data location. */
export const APP_FOLDER_NAME = 'reinvent-compass';
/** The issued-pass record file inside the app-data folder. */
export const RECORD_FILE_NAME = 'issued-pass-record.json';
/** The folder for generated artifacts inside the app-data folder. */
export const OUTPUT_FOLDER_NAME = 'output';
/** The calendar file inside the output folder. */
export const CALENDAR_FILE_NAME = 'reinvent.ics';
/** The itinerary page inside the output folder. */
export const ITINERARY_FILE_NAME = 'itinerary.html';

/** What the resolver reads from the machine. */
export interface AppDataEnvironment {
  platform: string;
  env: Record<string, string | undefined>;
  homeDir: string;
}

/** Build the resolver for an environment. */
export function createAppDataResolver(environment: AppDataEnvironment): AppDataResolver {
  const { platform, env, homeDir } = environment;
  return {
    resolve(): string {
      if (platform === 'win32') {
        const appData = env.APPDATA;
        const base = appData ? appData : win32.join(homeDir, 'AppData', 'Roaming');
        return win32.join(base, APP_FOLDER_NAME);
      }
      if (platform === 'darwin') {
        return posix.join(homeDir, 'Library', 'Application Support', APP_FOLDER_NAME);
      }
      // Linux and every other platform use the XDG data directory. The XDG rule is that
      // the variable must hold an absolute path; anything else is ignored.
      const xdg = env.XDG_DATA_HOME;
      const base = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(homeDir, '.local', 'share');
      return posix.join(base, APP_FOLDER_NAME);
    },
  };
}

/** The resolver for the machine this process runs on. */
export function createNodeAppDataResolver(): AppDataResolver {
  return createAppDataResolver({
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
  });
}

/**
 * Join path parts onto a resolved app-data root using the separator style of that root, so
 * a Windows root stays a Windows path whatever host runs the code.
 */
export function joinInFolder(root: string, ...parts: string[]): string {
  const style = /^[A-Za-z]:[\\/]/.test(root) || root.includes('\\') ? win32 : posix;
  return style.join(root, ...parts);
}
