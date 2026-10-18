// GET .../passes/{passTypeIdentifier}/{serialNumber}
// 200 with the latest signed pass and Last-Modified, 304 when If-Modified-Since is at or after
// Last_Updated at second precision, 401 when the ApplePass token does not match.
import type { PasskitDeps } from '../../app/deps.js';
import { header } from '../../http/event.js';
import { binary, empty } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { passTemplateInput } from '../../services/pass-template-input.js';
import { authorizeApplePass } from './authorize-apple-pass.js';

export const getLatestPass: Handler<PasskitDeps> = async (req, deps) => {
  const rec = await authorizeApplePass(req.event, deps, req.now);
  const since = Date.parse(header(req.event, 'if-modified-since') ?? '');
  if (Math.floor(rec.lastUpdatedMs / 1000) <= Math.floor(since / 1000)) {
    return empty(304);
  }
  const input = await passTemplateInput(rec, {
    secrets: deps.secrets,
    publicBaseUrl: deps.config.publicBaseUrl,
    passkitPath: deps.config.passkitPath,
    timezone: deps.config.eventTimezone,
  });
  return binary(200, 'application/vnd.apple.pkpass', await deps.signer.signPass(input), {
    'last-modified': new Date(rec.lastUpdatedMs).toUTCString(),
  });
};
