// Layout of the sample pass image (showcase-site, Component 8).
//
// The pass is drawn as inline SVG. SVG text does not wrap, so the lines and their positions are
// worked out here. The pass has no barcode, no QR code, no AWS mark and no AWS colour.

import type { SamplePass } from './sample-pass';

export const PASS_WIDTH = 360;
const LEFT = 16;
const TOP = 30;
const WRAP_AT = 32;

export interface PassLine {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly kind: 'label' | 'code' | 'title' | 'gate' | 'seat' | 'detail' | 'disclaimer';
}

export interface PassLayout {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly PassLine[];
}

const STEP: Record<PassLine['kind'], number> = {
  label: 22,
  code: 34,
  title: 20,
  gate: 22,
  seat: 36,
  detail: 20,
  disclaimer: 22,
};

/** Break text into lines of at most `width` characters, at spaces where it can. */
export function wrapText(text: string, width: number = WRAP_AT): readonly string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const chunks = Array.from({ length: Math.max(1, Math.ceil(word.length / width)) }, (_, i) =>
      word.slice(i * width, (i + 1) * width),
    );
    for (const chunk of chunks) {
      const candidate = current === '' ? chunk : `${current} ${chunk}`;
      if (candidate.length <= width) {
        current = candidate;
      } else {
        lines.push(current);
        current = chunk;
      }
    }
  }
  lines.push(current);
  return lines;
}

/** The lines of a sample pass with their positions. */
export function layoutPass(pass: SamplePass): PassLayout {
  const wanted: [PassLine['kind'], string][] = [
    ['label', pass.label],
    ['code', pass.sessionCode],
    ...wrapText(pass.title).map((line): [PassLine['kind'], string] => ['title', line]),
    ['gate', `Gate: ${pass.gate}`],
    ['seat', pass.seatReleased],
    ['detail', pass.walkFromPrevious ?? 'Walk from the previous session: not known'],
    [
      'detail',
      pass.nextConnection === null ? 'Next connection: not known' : `Next: ${pass.nextConnection}`,
    ],
    ['disclaimer', pass.disclaimer],
  ];
  let y = TOP;
  const lines = wanted.map(([kind, text]): PassLine => {
    const line = { x: LEFT, y, text, kind };
    y += STEP[kind];
    return line;
  });
  return { width: PASS_WIDTH, height: y + 8, lines };
}
