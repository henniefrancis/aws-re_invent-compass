// Writes src/apple/artwork.ts from the artwork drawn in src/artwork. Run once, then commit
// the generated module:
//   node packages/pass-service/scripts/run.mjs packages/pass-service/scripts/make-artwork.ts
import { writeFileSync } from 'node:fs';
import { artworkModuleSource, renderArtwork } from '../src/artwork/render.js';

const target = new URL('../src/apple/artwork.ts', import.meta.url);
writeFileSync(target, artworkModuleSource(renderArtwork()));
console.log('wrote src/apple/artwork.ts');
