// Finds the files the server ships with: the venue list, the sample repo, the simulated fixtures and
// the scan worker. Everything is looked up relative to the package root, the folder with the
// `package.json` above the running code, so it works the same from a checkout (`src/`), from the
// built package (`dist/`) and from an unpacked npm tarball. The built package carries its copies
// under `dist/`; a checkout falls back to the repository's own folders, two levels up. Nothing is
// read here; the caller passes `exists`.

import { CompassError } from '../ports/errors.js';

/** The bundled and repository locations of one resource, relative to the package root. */
export interface ResourceLocation {
  bundled: string;
  repository: string;
}

/** The venue list. */
export const VENUES_LOCATION: ResourceLocation = {
  bundled: 'dist/data/venues.json',
  repository: '../../data/venues.json',
};

/** The sample repo used by the demo. */
export const SAMPLE_REPO_LOCATION: ResourceLocation = {
  bundled: 'dist/sample-repo',
  repository: '../../fixtures/sample-repo',
};

/** The simulated fixtures folder (`api` and `synthetic` inside it) used by simulated mode. */
export const FIXTURES_LOCATION: ResourceLocation = {
  bundled: 'dist/fixtures',
  repository: '../../fixtures',
};

/** The scan worker. It exists only in a built package, so a checkout scans in its own thread. */
export const SCAN_WORKER_LOCATION: ResourceLocation = {
  bundled: 'dist/scan-worker.js',
  repository: 'dist/scan-worker.js',
};

/**
 * The folder of the nearest `package.json` at or above the folder of `moduleUrl`, as a URL ending in
 * `/`. When there is none, the module's own folder is returned, so every later lookup fails with
 * the fixed internal error instead of this one throwing.
 */
export async function findPackageRoot(
  moduleUrl: string,
  exists: (url: URL) => Promise<boolean>,
): Promise<URL> {
  const start = new URL('.', moduleUrl);
  let directory = start;
  for (;;) {
    if (await exists(new URL('package.json', directory))) {
      return directory;
    }
    const parent = new URL('..', directory);
    if (parent.href === directory.href) {
      return start;
    }
    directory = parent;
  }
}

/** The first candidate that exists, or an Internal error when none does. */
export async function findResource(
  packageRoot: URL,
  location: ResourceLocation,
  exists: (url: URL) => Promise<boolean>,
): Promise<URL> {
  for (const relative of [location.bundled, location.repository]) {
    const url = new URL(relative, packageRoot);
    if (await exists(url)) {
      return url;
    }
  }
  throw new CompassError('Internal');
}

/** Like `findResource`, but returns undefined when nothing exists. */
export async function findOptionalResource(
  packageRoot: URL,
  location: ResourceLocation,
  exists: (url: URL) => Promise<boolean>,
): Promise<URL | undefined> {
  try {
    return await findResource(packageRoot, location, exists);
  } catch {
    return undefined;
  }
}
