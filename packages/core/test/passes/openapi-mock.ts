// An in-memory Compass API mock built from contracts/compass-api.openapi.yaml
// (boarding-passes, S4, Requirement 9.4).
//
// The mock reads the contract file (read-only) at load time, so routes, methods,
// security requirements, request schemas and response shapes all come from the single
// source. A request that violates the contract is recorded as a violation and answered
// with a 400 problem, and the default answer to a valid request is generated from the
// declared success response schema. Tests can queue scripted responses per operation.
//
// The repository declares no YAML parser, so this file carries a small parser for the
// subset of YAML the contract uses: block mappings and sequences, flow lists, quoted and
// plain scalars and folded scalars. It is test support, not shipped code.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HttpRequest, HttpResponse, HttpTransport } from '../../src/passes/interfaces.js';

type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml };
type YamlMap = { [key: string]: Yaml };
interface Line {
  indent: number;
  text: string;
}

function tokenise(source: string): Line[] {
  const lines: Line[] = [];
  for (const raw of source.split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(raw)) {
      continue;
    }
    lines.push({ indent: raw.length - raw.trimStart().length, text: raw.trim() });
  }
  return lines;
}

function parseScalar(text: string): Yaml {
  const value = text.trim();
  if (value === '[]') {
    return [];
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((part) => parseScalar(part));
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function splitKey(text: string): { key: string; rest: string } {
  const quote = text[0];
  if (quote === "'" || quote === '"') {
    const end = text.indexOf(quote, 1);
    return { key: text.slice(1, end), rest: text.slice(end + 2).trim() };
  }
  const match = /^(.*?):(?:\s+(.*))?$/.exec(text);
  if (!match) {
    throw new Error('mock: cannot read a mapping line from the contract');
  }
  return { key: match[1] ?? '', rest: (match[2] ?? '').trim() };
}

class Parser {
  private index = 0;
  constructor(private readonly lines: Line[]) {}

  parseDocument(): Yaml {
    return this.parseNode(this.lines[0]?.indent ?? 0);
  }

  private parseNode(indent: number): Yaml {
    const line = this.lines[this.index];
    if (line !== undefined && (line.text === '-' || line.text.startsWith('- '))) {
      return this.parseSequence(indent);
    }
    return this.parseMapping(indent);
  }

  private parseSequence(indent: number): Yaml {
    const items: Yaml[] = [];
    for (;;) {
      const line = this.lines[this.index];
      if (line?.indent !== indent || !(line.text === '-' || line.text.startsWith('- '))) {
        return items;
      }
      const item = line.text.slice(1).trim();
      if (item === '') {
        this.index += 1;
        items.push(this.parseNode(this.lines[this.index]?.indent ?? indent));
      } else if (/^(['"][^'"]+['"]|[^\s:'"][^:]*?):(\s|$)/.test(item) && !item.startsWith('[')) {
        // An inline mapping item: re-read the rest of the line as a mapping entry two
        // columns in, so following entries at that indent join the same mapping.
        this.lines[this.index] = { indent: indent + 2, text: item };
        items.push(this.parseMapping(indent + 2));
      } else {
        this.index += 1;
        items.push(parseScalar(item));
      }
    }
  }

  private parseMapping(indent: number): Yaml {
    const map: YamlMap = {};
    for (;;) {
      const line = this.lines[this.index];
      if (line?.indent !== indent || line.text.startsWith('- ')) {
        return map;
      }
      const { key, rest } = splitKey(line.text);
      this.index += 1;
      if (rest === '>-' || rest === '>' || rest === '|') {
        const parts: string[] = [];
        while ((this.lines[this.index]?.indent ?? 0) > indent) {
          parts.push(this.lines[this.index]?.text ?? '');
          this.index += 1;
        }
        map[key] = parts.join(' ');
      } else if (rest === '') {
        const next = this.lines[this.index];
        const nested =
          next !== undefined &&
          (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')));
        map[key] = nested ? this.parseNode(next.indent) : null;
      } else {
        map[key] = parseScalar(rest);
      }
    }
  }
}

export function parseYaml(source: string): Yaml {
  return new Parser(tokenise(source)).parseDocument();
}

// ----- OpenAPI model -------------------------------------------------------------------

type Schema = YamlMap;

interface ResponseSpec {
  contentType?: string;
  schema?: Schema;
}

export interface Operation {
  operationId: string;
  method: string;
  template: string;
  matcher: RegExp;
  secured: boolean;
  requestSchema?: Schema;
  responses: Record<string, ResponseSpec>;
}

const CONTRACT_PATH = fileURLToPath(
  new URL('../../../../contracts/compass-api.openapi.yaml', import.meta.url),
);

const document = parseYaml(readFileSync(CONTRACT_PATH, 'utf8')) as YamlMap;

function lookupRef(ref: string): YamlMap {
  let node: Yaml = document;
  for (const part of ref.replace(/^#\//, '').split('/')) {
    node = (node as YamlMap)[part];
  }
  return node as YamlMap;
}

function deref(node: Yaml | undefined): YamlMap {
  const map = node as YamlMap;
  return typeof map.$ref === 'string' ? deref(lookupRef(map.$ref)) : map;
}

function firstContent(node: YamlMap | undefined): ResponseSpec {
  const content = (node?.content ?? {}) as YamlMap;
  const [contentType] = Object.keys(content);
  if (contentType === undefined) {
    return {};
  }
  const entry = content[contentType] as YamlMap;
  return { contentType, schema: entry.schema === undefined ? undefined : deref(entry.schema) };
}

function loadOperations(): Operation[] {
  const operations: Operation[] = [];
  const paths = document.paths as YamlMap;
  for (const [template, item] of Object.entries(paths)) {
    for (const method of ['get', 'put', 'post', 'delete']) {
      const op = (item as YamlMap)[method] as YamlMap | undefined;
      if (op === undefined) {
        continue;
      }
      const responses: Record<string, ResponseSpec> = {};
      for (const [status, spec] of Object.entries(op.responses as YamlMap)) {
        responses[status] = firstContent(deref(spec));
      }
      const body =
        op.requestBody === undefined ? undefined : firstContent(op.requestBody as YamlMap);
      operations.push({
        operationId: op.operationId as string,
        method: method.toUpperCase(),
        template,
        matcher: new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`),
        secured: Array.isArray(op.security) && op.security.length > 0,
        requestSchema: body?.schema,
        responses,
      });
    }
  }
  return operations;
}

export const operations = loadOperations();

export function operationFor(operationId: string): Operation {
  const found = operations.find((op) => op.operationId === operationId);
  if (found === undefined) {
    throw new Error('mock: unknown operation');
  }
  return found;
}

// ----- Schema validation and example generation ------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Return the list of contract violations for a value against a schema (empty when valid). */
export function violations(value: unknown, schemaNode: Yaml, path = '$'): string[] {
  const schema = deref(schemaNode);
  const problems: string[] = [];
  if (value === null && schema.nullable === true) {
    return problems;
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [`${path}: expected object`];
      }
      const record = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as YamlMap;
      for (const required of (schema.required ?? []) as string[]) {
        if (!(required in record)) problems.push(`${path}.${required}: missing`);
      }
      for (const [key, member] of Object.entries(record)) {
        if (key in properties) {
          problems.push(...violations(member, properties[key], `${path}.${key}`));
        } else if (schema.additionalProperties === false) {
          problems.push(`${path}.${key}: not allowed`);
        }
      }
      return problems;
    }
    case 'array': {
      if (!Array.isArray(value)) return [`${path}: expected array`];
      if (typeof schema.minItems === 'number' && value.length < schema.minItems)
        problems.push(`${path}: too few items`);
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
        problems.push(`${path}: too many items`);
      value.forEach((item, i) =>
        problems.push(...violations(item, schema.items, `${path}[${String(i)}]`)),
      );
      return problems;
    }
    case 'string': {
      if (typeof value !== 'string') return [`${path}: expected string`];
      if (typeof schema.minLength === 'number' && value.length < schema.minLength)
        problems.push(`${path}: too short`);
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
        problems.push(`${path}: too long`);
      if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value))
        problems.push(`${path}: pattern`);
      if (schema.format === 'uuid' && !UUID.test(value)) problems.push(`${path}: uuid`);
      if (schema.format === 'date-time' && !DATE_TIME.test(value))
        problems.push(`${path}: date-time`);
      if (Array.isArray(schema.enum) && !schema.enum.includes(value))
        problems.push(`${path}: enum`);
      return problems;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value))
        return [`${path}: expected integer`];
      if (typeof schema.minimum === 'number' && value < schema.minimum)
        problems.push(`${path}: below minimum`);
      if (typeof schema.maximum === 'number' && value > schema.maximum)
        problems.push(`${path}: above maximum`);
      return problems;
    }
    case 'boolean':
      return typeof value === 'boolean' ? problems : [`${path}: expected boolean`];
    default:
      return problems;
  }
}

/** Generate an example value that satisfies a schema. */
export function example(schemaNode: Yaml): unknown {
  const schema = deref(schemaNode);
  switch (schema.type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as YamlMap;
      const out: Record<string, unknown> = {};
      for (const key of (schema.required ?? []) as string[]) {
        out[key] = example(properties[key]);
      }
      return out;
    }
    case 'array':
      return Array.from({ length: Math.max(1, Number(schema.minItems ?? 0)) }, () =>
        example(schema.items),
      );
    case 'string':
      if (Array.isArray(schema.enum)) return schema.enum[0];
      if (schema.format === 'uuid') return '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';
      if (schema.format === 'date-time') return '2026-12-01T10:00:00Z';
      return 'example';
    case 'integer':
      return Number(schema.minimum ?? 1);
    case 'boolean':
      return true;
    default:
      return null;
  }
}

// ----- The mock transport ----------------------------------------------------------------

export interface RecordedRequest {
  operationId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  binary?: boolean;
  /** Contract violations found in this request. Empty for a conforming request. */
  violations: string[];
}

export interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  bytes?: Uint8Array;
}

export interface ContractMock extends HttpTransport {
  requests: RecordedRequest[];
  /** Queue scripted responses for an operation; they are served before the default. */
  enqueue(operationId: string, ...responses: MockResponse[]): void;
  /** Install a handler that answers every request to an operation. */
  handle(operationId: string, handler: (request: RecordedRequest) => MockResponse): void;
  /** Make the next request fail at the transport with this error. */
  failNext(error: Error): void;
}

export function problem(status: number, code = 'compass_error'): MockResponse {
  return {
    status,
    headers: { 'content-type': 'application/problem+json' },
    body: JSON.stringify({ type: 'about:blank', title: 'Problem', status, code }),
  };
}

export function jsonResponse(status: number, value: unknown): MockResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

function defaultResponse(op: Operation): MockResponse {
  const status = Object.keys(op.responses).find((code) => code.startsWith('2')) ?? '200';
  const spec = op.responses[status] ?? {};
  if (spec.contentType === 'application/json' && spec.schema !== undefined) {
    return jsonResponse(Number(status), example(spec.schema));
  }
  if (spec.contentType !== undefined) {
    return {
      status: Number(status),
      headers: { 'content-type': spec.contentType },
      body: '',
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    };
  }
  return { status: Number(status), headers: {}, body: '' };
}

/** basePath is a path prefix the mock strips before matching, for a client given a prefixed base URL. */
export function createContractMock(basePath = ''): ContractMock {
  const requests: RecordedRequest[] = [];
  const queues = new Map<string, MockResponse[]>();
  const handlers = new Map<string, (request: RecordedRequest) => MockResponse>();
  let pendingFailure: Error | undefined;

  return {
    requests,
    enqueue(operationId, ...responses) {
      queues.set(operationId, [...(queues.get(operationId) ?? []), ...responses]);
    },
    handle(operationId, handler) {
      handlers.set(operationId, handler);
    },
    failNext(error) {
      pendingFailure = error;
    },
    request(req: HttpRequest): Promise<HttpResponse> {
      if (pendingFailure !== undefined) {
        const error = pendingFailure;
        pendingFailure = undefined;
        return Promise.reject(error);
      }
      const path = new URL(req.url).pathname.slice(basePath.length);
      const op = operations.find((o) => o.method === req.method && o.matcher.test(path));
      if (op === undefined) {
        return Promise.resolve(toHttp(problem(404, 'no_route')));
      }
      const body = req.body === undefined ? undefined : (JSON.parse(req.body) as unknown);
      const found: string[] = [];
      if (op.requestSchema !== undefined) {
        found.push(...violations(body, op.requestSchema));
      }
      const record: RecordedRequest = {
        operationId: op.operationId,
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        binary: req.binary,
        violations: found,
      };
      requests.push(record);
      if (op.secured && !(req.headers.authorization ?? '').startsWith('Bearer ')) {
        return Promise.resolve(toHttp(problem(401, 'unauthorized')));
      }
      if (found.length > 0) {
        return Promise.resolve(toHttp(problem(400, 'bad_request')));
      }
      const scripted = queues.get(op.operationId)?.shift();
      const handler = handlers.get(op.operationId);
      return Promise.resolve(toHttp(scripted ?? (handler ? handler(record) : defaultResponse(op))));
    },
  };
}

function toHttp(response: MockResponse): HttpResponse {
  return {
    status: response.status,
    headers: response.headers ?? {},
    body: response.body ?? '',
    ...(response.bytes ? { bytes: response.bytes } : {}),
  };
}
