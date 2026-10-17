// Finds the files the server ships with: the venue list and the sample repo. The published package
// carries them next to the compiled code; a checkout carries them at the repository root. Both
// layouts are the same depth below the package (`src/cli/` and `dist/cli/`), so one list of relative
// candidates covers both. Nothing is read here; the caller passes `exists`.

import { CompassError } from '../ports/errors.js';

/** The bundled and repository locations of one resource, relative to a module in `src/cli` or `dist/cli`. */
export interface ResourceLocation {
  bundled: string;
  repository: string;
}

/** The venue list. */
export const VENUES_LOCATION: ResourceLocation = {
  bundled: '../data/venues.json',
  repository: '../../../../data/venues.json',
};

/** The sample repo used by the demo. */
export const SAMPLE_REPO_LOCATION: ResourceLocation = {
  bundled: '../sample-repo',
  repository: '../../../../fixtures/sample-repo',
};

/** The first candidate that exists, as a file URL string, or an Internal error when none does. */
export async function findResource(
  moduleUrl: string,
  location: ResourceLocation,
  exists: (url: URL) => Promise<boolean>,
): Promise<URL> {
  for (const relative of [location.bundled, location.repository]) {
    const url = new URL(relative, moduleUrl);
    if (await exists(url)) {
      return url;
    }
  }
  throw new CompassError('Internal');
}
