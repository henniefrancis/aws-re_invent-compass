// Opens the sign-in page in the attendee's browser without a shell. The platform is injected
// (no platform branch reads `process.platform`), the address must be https, and the command is
// run with `execFile` so the address is one argument and never parsed by a shell. When the page
// cannot be opened, the address is shown on stderr so the attendee can open it by hand; it holds
// no token, only the one-time sign-in request.

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
