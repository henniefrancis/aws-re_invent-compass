// Switch off zod's `new Function` probe (showcase-site, CSP).
//
// The rules engine and @compass/contracts build their zod schemas when their modules load. By
// default zod then tries `new Function("")` to see whether it may compile faster parsers, and a
// strict Content-Security-Policy (no 'unsafe-eval') reports that caught attempt as a violation.
// Setting `jitless` first avoids the attempt. This module must be imported before the engine:
// rules-port.ts imports it first, and ES modules run in import order.

import { config } from 'zod/v4/core';

config({ jitless: true });
