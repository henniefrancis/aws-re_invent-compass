/**
 * The next Last_Updated: the later of the current second and one whole second after the
 * previous value, always a whole second. A second-precision If-Modified-Since equal to the
 * old value therefore always sees the change, even when the clock stands still or goes back.
 */
export function nextLastUpdated(previousMs: number, nowMs: number): number {
  return Math.max(Math.floor(nowMs / 1000) * 1000, Math.floor(previousMs / 1000) * 1000 + 1000);
}
