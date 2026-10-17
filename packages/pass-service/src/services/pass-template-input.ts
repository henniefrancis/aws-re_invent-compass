// Builds the template input for a stored pass. The Auth_Token is re-derived from the pepper,
// the serial and the pass's token salt, so every rebuild carries the same token and the
// token itself is never stored.
import type { PassTemplateInput } from '../apple/pass-template.js';
import { webServiceUrl } from '../config/config.js';
import type { PassRecord } from '../data/records.js';
import { deriveAuthToken } from '../security/auth-token.js';
import type { SecretsProvider } from '../credentials/secrets-provider.js';

export interface TemplateSource {
  secrets: SecretsProvider;
  publicBaseUrl: string;
  passkitPath: string;
  timezone: string;
}

export async function passTemplateInput(
  rec: PassRecord,
  source: TemplateSource,
): Promise<PassTemplateInput> {
  const [app, apple] = await Promise.all([source.secrets.app(), source.secrets.apple()]);
  const common = {
    serialNumber: rec.serialNumber,
    fields: rec.fields,
    authToken: deriveAuthToken(app.pepper, rec.serialNumber, rec.tokenSalt),
    webServiceUrl: webServiceUrl(source),
    timezone: source.timezone,
    apple: { passTypeIdentifier: apple.passTypeIdentifier, teamIdentifier: apple.teamIdentifier },
  };
  return rec.voidedAt !== undefined
    ? { ...common, status: 'voided', voidedAt: rec.voidedAt }
    : { ...common, status: 'active' };
}
