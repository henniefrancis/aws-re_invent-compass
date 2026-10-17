// Validates a response body against the OpenAPI document with ajv. The contract is OpenAPI 3.0,
// so `nullable: true` is switched on in ajv; `$ref`s resolve against the document's components.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Ajv from 'ajv';

// Typed by hand so the check does not depend on @types/js-yaml being installed.
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };

type Json = Record<string, unknown>;

const document = yaml.load(
  readFileSync(new URL('../../../../contracts/compass-api.openapi.yaml', import.meta.url), 'utf8'),
) as Json;

const ajv = new Ajv({ nullable: true, unknownFormats: 'ignore', allErrors: true });

/** The schema the contract declares for one operation, status and media type. */
function responseSchema(path: string, method: string, status: number, contentType: string): Json {
  const paths = document.paths as Record<string, Record<string, Json>>;
  const responses = paths[path]?.[method]?.responses as Record<string, Json> | undefined;
  let response = responses?.[String(status)];
  const ref = response?.$ref;
  if (typeof ref === 'string') {
    const shared = (document.components as Json).responses as Record<string, Json>;
    response = shared[ref.replace('#/components/responses/', '')];
  }
  const content = response?.content as Record<string, Json> | undefined;
  const schema = content?.[contentType]?.schema as Json | undefined;
  if (schema === undefined) {
    throw new Error(`no schema for ${method} ${path} ${status} ${contentType}`);
  }
  return schema;
}

/** Returns the ajv error text, or an empty string when the body conforms. */
export function validateAgainstContract(
  path: string,
  method: string,
  status: number,
  contentType: string,
  body: unknown,
): string {
  const root = {
    ...responseSchema(path, method, status, contentType),
    components: document.components,
  };
  const validate = ajv.compile(root);
  return validate(body) ? '' : ajv.errorsText(validate.errors);
}
