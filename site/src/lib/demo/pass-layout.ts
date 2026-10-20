// Layout of the sample pass image (showcase-site, Component 8).
//
// The pass is drawn as inline SVG. SVG text does not wrap, so the lines and their positions are
// worked out here. The face follows the final Apple pass: logo and SESSION on top, TERMINAL, an
// arrow and GATE, FLIGHT NAME, then DATE and BOARDING CLOSES. The walk, the next connection, the
// sample label and the disclaimer are small lines under the card face (on the real pass the walk
// and the next session are on the back). The pass has no barcode, no QR code and no AWS mark.

import type { SamplePass } from './sample-pass';

export const PASS_WIDTH = 360;
/**
 * The card colours of the final Apple pass: background #232F3F and white values. The real pass
 * uses the label colour #A166FF by owner decision; the site promises WCAG 2.2 AA and #A166FF is
 * only about 3.8:1 on this background, so the sample uses #BE9BFF (about 6.0:1). The same values
 * are written in the .pass rules of components.css.
 */
export const PASS_COLOURS = {
  background: '#232F3F',
  value: '#FFFFFF',
  label: '#BE9BFF',
} as const;
const LEFT = 16;
const RIGHT = PASS_WIDTH - 16;
const WRAP_AT = 32;
/** Characters per line of a large value (venue or room) in a column of the card. */
const VALUE_WIDTH = 13;
const VALUE_LINES = 2;

export interface PassLine {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly kind: 'label' | 'session' | 'large' | 'title' | 'value' | 'small' | 'disclaimer';
  readonly anchor: 'start' | 'end';
  /** True for text on the card face, false for the small lines under it. */
  readonly onCard: boolean;
}

export interface PassLayout {
  readonly width: number;
  readonly height: number;
  /** Height of the card face; the small lines sit below it. */
  readonly cardHeight: number;
  readonly logo: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** The centre of the arrow between TERMINAL and GATE. */
  readonly arrow: { readonly x: number; readonly y: number };
  readonly lines: readonly PassLine[];
}

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

/** A venue or room in at most two lines of 13 characters; what does not fit becomes "...". */
export function fitValue(text: string): readonly string[] {
  const lines = wrapText(text, VALUE_WIDTH);
  if (lines.length <= VALUE_LINES) {
    return lines;
  }
  const last = (lines[VALUE_LINES - 1] as string).slice(0, VALUE_WIDTH - 3).trimEnd();
  return [...lines.slice(0, VALUE_LINES - 1), `${last}...`];
}

/** The lines of a sample pass with their positions. */
export function layoutPass(pass: SamplePass): PassLayout {
  const lines: PassLine[] = [];
  const put = (
    kind: PassLine['kind'],
    text: string,
    x: number,
    y: number,
    anchor: PassLine['anchor'] = 'start',
    onCard = true,
  ): void => {
    lines.push({ x, y, text, kind, anchor, onCard });
  };
  // Top row: the logo on the left, SESSION and the code on the right.
  put('label', 'SESSION', RIGHT, 26, 'end');
  put('session', pass.session, RIGHT, 52, 'end');
  // Large row: TERMINAL, an arrow, GATE.
  put('label', 'TERMINAL', LEFT, 86);
  put('label', 'GATE', RIGHT, 86, 'end');
  const terminal = fitValue(pass.terminal);
  const gate = fitValue(pass.gate);
  terminal.forEach((text, i) => {
    put('large', text, LEFT, 110 + i * 24);
  });
  gate.forEach((text, i) => {
    put('large', text, RIGHT, 110 + i * 24, 'end');
  });
  let y = 110 + (Math.max(terminal.length, gate.length) - 1) * 24 + 34;
  // Flight name.
  put('label', 'FLIGHT NAME', LEFT, y);
  y += 22;
  for (const text of wrapText(pass.title)) {
    put('title', text, LEFT, y);
    y += 20;
  }
  y += 14;
  // Bottom row: DATE and BOARDING CLOSES.
  put('label', 'DATE', LEFT, y);
  put('label', 'BOARDING CLOSES', RIGHT, y, 'end');
  y += 22;
  put('value', pass.date, LEFT, y);
  put('value', pass.boardingCloses, RIGHT, y, 'end');
  const cardHeight = y + 18;
  // Under the card face: the walk, the next connection, the label and the disclaimer.
  y = cardHeight + 24;
  const small: string[] = [
    pass.walkFromPrevious ?? 'Walk from the previous session: not known',
    pass.nextConnection === null ? 'Next connection: not known' : `Next: ${pass.nextConnection}`,
    ...(pass.boardingNote === null ? [] : [pass.boardingNote]),
    pass.label,
  ];
  for (const text of small) {
    put('small', text, LEFT, y, 'start', false);
    y += 20;
  }
  put('disclaimer', pass.disclaimer, LEFT, y, 'start', false);
  return {
    width: PASS_WIDTH,
    height: y + 10,
    cardHeight,
    logo: { x: LEFT, y: 14, width: 84, height: 36 },
    arrow: { x: PASS_WIDTH / 2, y: 102 },
    lines,
  };
}
