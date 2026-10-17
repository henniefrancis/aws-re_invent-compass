// POST /api/passkit/v1/log: devices post diagnostics. Only the count is kept, as a metric;
// no message text is stored or logged.
import type { PasskitDeps } from '../../app/deps.js';
import { empty } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { parseLogBody } from '../../validation/request-schemas.js';

export const logMessages: Handler<PasskitDeps> = (req) => {
  req.metrics.add('PasskitLogMessages', parseLogBody(req.event).count);
  return Promise.resolve(empty(200));
};
