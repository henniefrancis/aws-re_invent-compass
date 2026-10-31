// The Permissions-Policy header the site is built to run under (showcase-site task 40). This is
// the single source. The Static_Server (preview and e2e) sends it, and a test in infra compares it
// with the CloudFront response headers policy in infra/modules/edge/locals.tf, so the preview
// cannot work while production blocks a feature.
//
// geolocation is (self): only the Compass site itself may ask for the location, and no embedded
// frame can. "Walk from here" on the board page needs it. Everything else is switched off.

export const PERMISSIONS_POLICY_DIRECTIVES = Object.freeze([
  'accelerometer=()',
  'camera=()',
  'geolocation=(self)',
  'gyroscope=()',
  'microphone=()',
  'payment=()',
  'usb=()',
]);

export const REQUIRED_PERMISSIONS_POLICY = PERMISSIONS_POLICY_DIRECTIVES.join(', ');
