// Opens the sign-in page in the attendee's browser without a shell. The platform is injected
// (no platform branch reads `process.platform`), the address must be https, and the command is
// run with `execFile` so the address is one argument and never parsed by a shell. When the page
// cannot be opened, the address is shown on stderr so the attendee can open it by hand; it holds
// no token, only the one-time sign-in request.

import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

/** `execFile` with a callback, the shape of `node:child_process`. */
export type ExecFileLike = (
  file: string,
  args: string[],
  callback: (error: Error | null) => void,
) => unknown;

/** What the opener needs. */
export interface BrowserOpenerDeps {
  platform: string;
  execFile: ExecFileLike;
  /** Writes one line to stderr. */
  notify(line: string): void;
}

function commandFor(platform: string, url: string): [string, string[]] {
  if (platform === 'win32') {
    return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  }
  return platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
}

/** What the local page opener needs. */
export interface LocalPageOpenerDeps {
  platform: string;
  execFile: ExecFileLike;
  /** How long to wait for the command; past it the open counts as failed. Default 5 seconds. */
  timeoutMs?: number;
}

/** The default wait for the open command (security review M1 of task 48). */
export const LOCAL_PAGE_OPEN_TIMEOUT_MS = 5000;

/**
 * Creates the opener for a page Compass wrote on this computer (the QR page, task 48). It takes
 * an absolute path to an .html file, turns it into its file: URL and runs the same platform
 * command as the sign-in opener, without a shell. It resolves true only when the command
 * reported success within the timeout; anything else, including a path that is not an absolute
 * .html path or a command that never returns (an xdg-open that waits for the browser), resolves
 * false, so the tool falls back to the QR code in the chat. It never throws and never writes the
 * path anywhere.
 */
export function createLocalPageOpener(
  deps: LocalPageOpenerDeps,
): (path: string) => Promise<boolean> {
  const timeoutMs = deps.timeoutMs ?? LOCAL_PAGE_OPEN_TIMEOUT_MS;
  return (path) =>
    new Promise((resolve) => {
      if (!isAbsolute(path) || !path.endsWith('.html')) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
      timer.unref();
      const settle = (opened: boolean): void => {
        clearTimeout(timer);
        resolve(opened);
      };
      const [file, args] = commandFor(deps.platform, pathToFileURL(path).href);
      try {
        deps.execFile(file, args, (error) => {
          settle(error === null);
        });
      } catch {
        settle(false);
      }
    });
}

/** Creates the opener S1's sign-in calls with the authorize address. It never throws. */
export function createBrowserOpener(deps: BrowserOpenerDeps): (url: string) => void {
  const fallback = (url: string): void => {
    deps.notify(`Open this address in your browser to finish signing in: ${url}`);
  };
  return (url) => {
    if (!url.startsWith('https://')) {
      fallback(url);
      return;
    }
    const [file, args] = commandFor(deps.platform, url);
    try {
      deps.execFile(file, args, (error) => {
        if (error !== null) {
          fallback(url);
        }
      });
    } catch {
      fallback(url);
    }
  };
}
