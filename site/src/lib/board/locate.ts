// Asking the browser where the phone is (showcase-site task 40, ADR-037).
//
// Called only when the attendee taps "Walk from here". It asks once (no watching) and keeps the
// answer in memory for the one estimate. Nothing is sent, stored or logged.

import type { Coordinates } from './walk-estimate';

export type LocateResult =
  | { readonly ok: true; readonly position: Coordinates }
  | { readonly ok: false; readonly reason: 'denied' | 'unavailable' | 'timeout' };

/** The part of the browser's Geolocation object this code uses. */
export interface GeolocationLike {
  getCurrentPosition(
    success: (position: { coords: { latitude: number; longitude: number } }) => void,
    failure: (error: { code: number }) => void,
    options: { enableHighAccuracy: boolean; timeout: number; maximumAge: number },
  ): void;
}

/** A rough fix is enough for a walk, and it saves the battery. */
export const LOCATE_OPTIONS = {
  enableHighAccuracy: false,
  /** Milliseconds to wait for the phone to answer. */
  timeout: 10_000,
  /** A fix older than this many milliseconds is not reused. */
  maximumAge: 30_000,
} as const;

/** The values of GeolocationPositionError.code. */
const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

function validPoint(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/** One position from the phone, or the reason there is none. */
export function locate(geolocation: GeolocationLike | undefined): Promise<LocateResult> {
  if (geolocation === undefined) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => {
          resolve(
            validPoint(coords.latitude, coords.longitude)
              ? { ok: true, position: { lat: coords.latitude, lon: coords.longitude } }
              : { ok: false, reason: 'unavailable' },
          );
        },
        (error) => {
          resolve({
            ok: false,
            reason:
              error.code === PERMISSION_DENIED
                ? 'denied'
                : error.code === TIMEOUT
                  ? 'timeout'
                  : 'unavailable',
          });
        },
        LOCATE_OPTIONS,
      );
    } catch {
      resolve({ ok: false, reason: 'unavailable' });
    }
  });
}
