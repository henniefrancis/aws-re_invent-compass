// The single live Compass API base URL (task 1.2, Open Question 10).
//
// The production CloudFront domain is known only after S6 deploys, so this is a
// placeholder on the reserved .invalid domain (RFC 2606): it can never resolve, and a
// live run with the placeholder fails loudly instead of reaching a wrong host. The
// integrator sets the real value before 1.0.0. It is a build-time constant: COMPASS_API_URL can
// override it only together with COMPASS_ALLOW_API_OVERRIDE=1 (see runtime-config.ts).

/** The live Compass API base URL, without a trailing slash. */
export const COMPASS_API_BASE_URL = 'https://compass.invalid';
