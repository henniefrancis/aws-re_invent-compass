/** Matches an en dash or an em dash. Built from char codes so no source file holds one. */
export const DASH_PATTERN = new RegExp(
  `[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`,
);
