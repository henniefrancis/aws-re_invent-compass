import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const BACKSLASH = String.fromCharCode(92);

/** The site folder, resolved from this file. */
export const SITE_ROOT = join(import.meta.dirname, '..', '..');

/** One source file with its text and its path relative to the site folder. */
export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/** Every file under a folder of the site (empty when the folder does not exist yet). */
export function listFiles(dir: string, extensions: readonly string[]): readonly SourceFile[] {
  const root = join(SITE_ROOT, dir);
  const found: SourceFile[] = [];
  const walk = (current: string): void => {
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extensions.some((ext) => name.endsWith(ext))) {
        found.push({
          path: relative(SITE_ROOT, full).split(sep).join('/'),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return found;
}

/**
 * Replace comments with spaces and the inside of string and template literals with spaces,
 * so a rule only sees real code. Line breaks are kept so line numbers stay correct.
 */
export function stripNonCode(source: string): string {
  let out = '';
  let i = 0;
  const blank = (ch: string): string => (ch === '\n' ? '\n' : ' ');
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (ch === '/' && next === '/') {
      while (i < source.length && source.charAt(i) !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < source.length && !(source.charAt(i) === '*' && source.charAt(i + 1) === '/')) {
        out += blank(source.charAt(i));
        i += 1;
      }
      out += '  ';
      i += 2;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      out += ch;
      i += 1;
      while (i < source.length && source.charAt(i) !== ch) {
        if (source.charAt(i) === BACKSLASH) {
          out += ' ';
          i += 1;
        }
        out += blank(source.charAt(i));
        i += 1;
      }
      out += ch;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}
