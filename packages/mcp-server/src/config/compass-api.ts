// The single live Compass API base URL (task 1.2, Open Question 10; task 53).
//
// The production apex domain (ADR-031), set in the 0.1.0 release commit. It answers only
// once prod is deployed, so the owner tags v0.1.0 only after GET /api/v1/health returns 200.
// It is a build-time constant: COMPASS_API_URL can override it only together with
// COMPASS_ALLOW_API_OVERRIDE=1 (see runtime-config.ts), which is how dev is tested.

/** The live Compass API base URL, without a trailing slash. */
export const COMPASS_API_BASE_URL = 'https://reinvent-compass.vegas';
