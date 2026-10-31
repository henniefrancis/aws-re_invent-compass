// Writes src/apple/artwork.ts from the owner's artwork (pass-service task 38). Run once after
// the SVGs change, then commit the generated module:
//   node packages/pass-service/scripts/make-artwork.mjs
//
// The logo (site/public/artwork/logo.svg) is fitted to the slot height and left-aligned on a
// transparent canvas; the icon (site/public/artwork/favicon.svg) is fitted and centred on a
// transparent square; the owner's Pass Designer background (packages/pass-service/artwork/pass-background.png) covers the
// event ticket background, cropped and centred (task 44, the owner's Pass Designer design).
// Chromium from Playwright (a dev dependency) rasterises them, so no image library is added.
// Sizes follow Apple's Wallet Human Interface Guidelines: icon 38 points and logo up to 160 by
// 50 points at 1x, 2x and 3x; background 343 by 503 points (src/artwork/render.ts says which
// scales ship).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ARTWORK_FILES, artworkModuleSource } from '../src/artwork/render.ts';
import { GOOGLE_IMAGES } from '../src/google/google-layout.ts';

const artworkDir = new URL('../../../site/public/artwork/', import.meta.url);
// The pass background is a pass-only source, kept out of the site's public folder (task 44).
const passArtworkDir = new URL('../artwork/', import.meta.url);
// The Google Wallet images are files, not a module: Google fetches them by URL (task 47).
const googleDir = new URL('../artwork/google/', import.meta.url);
const MIME = { '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
const dataUrl = (name) =>
  `data:${MIME[name.slice(name.lastIndexOf('.'))]};base64,${readFileSync(new URL(name, name.endsWith('.png') ? passArtworkDir : artworkDir)).toString('base64')}`;

const JOBS = {
  'icon.png': { source: 'favicon.svg', width: 38, height: 38, align: 'centre' },
  'icon@2x.png': { source: 'favicon.svg', width: 76, height: 76, align: 'centre' },
  'icon@3x.png': { source: 'favicon.svg', width: 114, height: 114, align: 'centre' },
  'logo.png': { source: 'logo.svg', width: 160, height: 50, align: 'left' },
  'logo@2x.png': { source: 'logo.svg', width: 320, height: 100, align: 'left' },
  'logo@3x.png': { source: 'logo.svg', width: 480, height: 150, align: 'left' },
  'background.png': { source: 'pass-background.png', width: 343, height: 503, align: 'cover' },
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
        if (align === 'cover') {
          // A full-bleed background is opaque: the Pass Designer image has faintly transparent
          // edges, so it sits on the pass background colour, black (task 44).
          context.fillStyle = '#000000';
          context.fillRect(0, 0, width, height);
        }
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

  // The Google Wallet images (tasks 47 and 47.8), served from <PUBLIC_BASE_URL>/wallet/ (infra
  // task 25): the icon on the card blue as the round logo, the icon alone as the wide logo (1280 by 400, transparent, left-aligned), and the hero
  // (1032 by 812): the Pass Designer gradient, cover-cropped and centred, with the full logo
  // centred on it over a soft white glow so its purple text reads on the blue.
  mkdirSync(googleDir, { recursive: true });
  const google = {
    // Google masks the logo into a circle: the icon sits on the card blue with a 15 percent
    // margin on every side, as its brand guidelines ask (task 47.8).
    [GOOGLE_IMAGES.logo]: await page.evaluate(
      async ({ icon }) => {
        const image = new Image();
        image.src = icon;
        await image.decode();
        const size = 660;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.fillStyle = '#2035E2';
        context.fillRect(0, 0, size, size);
        const box = size * 0.7;
        const scale = Math.min(box / image.naturalWidth, box / image.naturalHeight);
        const w = image.naturalWidth * scale;
        const h = image.naturalHeight * scale;
        context.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { icon: dataUrl('favicon.svg') },
    ),
    [GOOGLE_IMAGES.wideLogo]: await page.evaluate(
      async ({ icon }) => {
        const image = new Image();
        image.src = icon;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 400;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        const scale = 400 / image.naturalHeight;
        context.drawImage(image, 0, 0, image.naturalWidth * scale, 400);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { icon: dataUrl('favicon.svg') },
    ),
    [GOOGLE_IMAGES.hero]: await page.evaluate(
      async ({ background, logo }) => {
        const load = async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          return image;
        };
        const [gradient, lockup] = [await load(background), await load(logo)];
        const width = 1032;
        const height = 812;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.fillStyle = '#000000';
        context.fillRect(0, 0, width, height);
        const cover = Math.max(width / gradient.naturalWidth, height / gradient.naturalHeight);
        const gw = gradient.naturalWidth * cover;
        const gh = gradient.naturalHeight * cover;
        context.drawImage(gradient, (width - gw) / 2, (height - gh) / 2, gw, gh);
        const lw = width * 0.72;
        const lh = (lockup.naturalHeight / lockup.naturalWidth) * lw;
        const lx = (width - lw) / 2;
        const ly = (height - lh) / 2;
        // The glow is the logo's own white shadow, drawn twice for strength, then the logo.
        context.shadowColor = 'rgba(255, 255, 255, 0.9)';
        context.shadowBlur = 36;
        context.drawImage(lockup, lx, ly, lw, lh);
        context.drawImage(lockup, lx, ly, lw, lh);
        context.shadowColor = 'transparent';
        context.shadowBlur = 0;
        context.drawImage(lockup, lx, ly, lw, lh);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { background: dataUrl('pass-background.png'), logo: dataUrl('logo.svg') },
    ),
  };
  for (const [name, base64] of Object.entries(google)) {
    writeFileSync(new URL(name, googleDir), Buffer.from(base64, 'base64'));
    console.log(`wrote artwork/google/${name}`);
  }
} finally {
  await browser.close();
}
