// Writes src/apple/artwork.ts from the owner's artwork (pass-service task 38). Run once after
// the SVGs change, then commit the generated module:
//   node packages/pass-service/scripts/make-artwork.mjs
//
// The logo (site/public/artwork/logo.svg) is fitted to the slot height and left-aligned on a
// transparent canvas; the icon (site/public/artwork/favicon.svg) is fitted and centred on a
// transparent square; the owner's picture (site/public/artwork/pass-background.jpg) covers the
// event ticket background, cropped and centred (task 44, the owner's Pass Designer design).
// Chromium from Playwright (a dev dependency) rasterises them, so no image library is added.
// Sizes follow Apple's Wallet Human Interface Guidelines: icon 38 points and logo up to 160 by
// 50 points at 1x, 2x and 3x; background 343 by 503 points (src/artwork/render.ts says which
// scales ship).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ARTWORK_FILES, artworkModuleSource } from '../src/artwork/render.ts';

const artworkDir = new URL('../../../site/public/artwork/', import.meta.url);
const MIME = { '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const dataUrl = (name) =>
  `data:${MIME[name.slice(name.lastIndexOf('.'))]};base64,${readFileSync(new URL(name, artworkDir)).toString('base64')}`;

const JOBS = {
  'icon.png': { source: 'favicon.svg', width: 38, height: 38, align: 'centre' },
  'icon@2x.png': { source: 'favicon.svg', width: 76, height: 76, align: 'centre' },
  'icon@3x.png': { source: 'favicon.svg', width: 114, height: 114, align: 'centre' },
  'logo.png': { source: 'logo.svg', width: 160, height: 50, align: 'left' },
  'logo@2x.png': { source: 'logo.svg', width: 320, height: 100, align: 'left' },
  'logo@3x.png': { source: 'logo.svg', width: 480, height: 150, align: 'left' },
  'background@2x.png': { source: 'pass-background.jpg', width: 686, height: 1006, align: 'cover' },
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const files = {};
  for (const name of ARTWORK_FILES) {
    const job = JOBS[name];
    const base64 = await page.evaluate(
      async ({ src, width, height, align }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const fit = align === 'cover' ? Math.max : Math.min;
        const scale = fit(width / image.naturalWidth, height / image.naturalHeight);
        const w = image.naturalWidth * scale;
        const h = image.naturalHeight * scale;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        const x = align === 'left' ? 0 : (width - w) / 2;
        context.drawImage(image, x, (height - h) / 2, w, h);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { src: dataUrl(job.source), width: job.width, height: job.height, align: job.align },
    );
    files[name] = Buffer.from(base64, 'base64');
  }
  const target = new URL('../src/apple/artwork.ts', import.meta.url);
  writeFileSync(target, artworkModuleSource(files));
  console.log('wrote src/apple/artwork.ts');
} finally {
  await browser.close();
}
