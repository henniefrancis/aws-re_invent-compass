// The single live Compass API base URL (task 1.2, Open Question 10).
//
// The production CloudFront domain is known only after S6 deploys, so this is a
// placeholder on the reserved .invalid domain (RFC 2606): it can never resolve, and a
// live run with the placeholder fails loudly instead of reaching a wrong host. The
// integrator sets the real value before 1.0.0. COMPASS_API_URL overrides it.

/** The live Compass API base URL, without a trailing slash. */
export const COMPASS_API_BASE_URL = 'https://compass.invalid';
