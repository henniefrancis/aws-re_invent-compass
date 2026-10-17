// App-data directory resolution (events-client, S1, task 13.1).
//
// The catalog cache lives in a per-user directory named reinvent-compass under the
// platform's application data location (Requirements 14.1 to 14.3):
//   - Windows: the %APPDATA% directory,
//   - macOS: ~/Library/Application Support,
//   - Linux and other POSIX: $XDG_DATA_HOME, else ~/.local/share.
// Pure function: the environment, the home directory and the platform are injected.

import { posix, win32 } from 'node:path';

/** The directory name used under the platform's application data location. */
export const APP_DATA_DIR_NAME = 'reinvent-compass';

/** The environment values this function reads. */
export type AppDataEnv = Readonly<Record<string, string | undefined>>;

/** True for a non-empty value. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

/**
 * Resolve the cache directory for a platform. `platform` is a Node platform name
 * ("win32", "darwin", "linux", ...). On Windows, if %APPDATA% is unset the standard
 * default location under the home directory is used. On Linux an XDG_DATA_HOME that
 * is not an absolute path is ignored, as the XDG specification requires.
 */
export function resolveAppDataDir(env: AppDataEnv, homeDir: string, platform: string): string {
  if (platform === 'win32') {
    const base = isSet(env.APPDATA) ? env.APPDATA : win32.join(homeDir, 'AppData', 'Roaming');
    return win32.join(base, APP_DATA_DIR_NAME);
  }
  if (platform === 'darwin') {
    return posix.join(homeDir, 'Library', 'Application Support', APP_DATA_DIR_NAME);
  }
  const xdg = env.XDG_DATA_HOME;
  const base = isSet(xdg) && posix.isAbsolute(xdg) ? xdg : posix.join(homeDir, '.local', 'share');
  return posix.join(base, APP_DATA_DIR_NAME);
}
