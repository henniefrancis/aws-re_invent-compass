// Strict request validation (Requirement 7, design Component 10).
//
// Every failure is the same 400 invalid_request, with no field name or value. No value is
// trimmed, truncated or normalised: a value that breaks a rule is refused. Unknown keys are
// refused at any depth before zod runs, because createPassFieldsSchema strips unknown keys
// and stripping would silently reinterpret the input.
//
// Two operations answer 401 instead (registerDevice, per Apple's contract and the OpenAPI
// file) and one never fails (logMessages lists only 200).
import { createPassFieldsSchema, type PassFields } from '@compass/contracts';
import { z } from 'zod';
import type { EventWindow } from '../config/config.js';
import type { ProxyEvent } from '../http/event.js';
import { ProblemError } from '../http/problem.js';
import { UUID_V4_PATTERN } from '../security/handoff-id.js';

export const MAX_BODY_BYTES = 64 * 1024;
export const PUSH_TOKEN_PATTERN = /^[0-9A-Fa-f]{1,256}$/;

export interface KeyShape {
  /** The properties the contract defines at this level. */
  keys: readonly string[];
  /** Nested objects, by property. */
  children?: Readonly<Record<string, KeyShape>>;
  /** Arrays of objects, by property. */
  lists?: Readonly<Record<string, KeyShape>>;
}

/** Key shapes taken from contracts/compass-api.openapi.yaml (checked against it in tests). */
export const PASS_FIELDS_SHAPE: KeyShape = {
  keys: [
    'sessionCode',
    'title',
    'venue',
    'room',
    'startsAt',
    'endsAt',
    'walkFromPrevious',
    'nextConnection',
    'attendeeName',
  ],
  children: {
    walkFromPrevious: { keys: ['minutes', 'fromVenue'] },
    nextConnection: { keys: ['sessionCode', 'startsAt', 'venue', 'walkMinutes'] },
  },
};
export const ISSUE_REQUEST_SHAPE: KeyShape = {
  keys: ['platforms', 'passes'],
  lists: { passes: PASS_FIELDS_SHAPE },
};
export const HANDOFF_REQUEST_SHAPE: KeyShape = {
  keys: ['serialNumbers', 'include'],
  children: { include: { keys: ['apple', 'google', 'calendar'] } },
};
export const DEVICE_REGISTRATION_SHAPE: KeyShape = { keys: ['pushToken'] };
export const LOG_ENTRIES_SHAPE: KeyShape = { keys: ['logs'] };

function invalid(): ProblemError {
  return new ProblemError(400, 'invalid_request');
}

type Read = { ok: true; value: unknown } | { ok: false };

/** Reads and parses the body without throwing. */
function readJson(event: ProxyEvent): Read {
  if (event.body === null || event.body === '') {
    return { ok: false };
  }
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** 400 when the body is empty, over 64 KiB, or not valid JSON. */
export function parseJsonBody(event: ProxyEvent): unknown {
  const read = readJson(event);
  if (!read.ok) {
    throw invalid();
  }
  return read.value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnknownKeys(value: unknown, shape: KeyShape): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!shape.keys.includes(key)) {
      return true;
    }
    const child = value[key];
    const nestedShape = shape.children?.[key];
    if (nestedShape !== undefined && hasUnknownKeys(child, nestedShape)) {
      return true;
    }
    const listShape = shape.lists?.[key];
    if (
      listShape !== undefined &&
      Array.isArray(child) &&
      child.some((element) => hasUnknownKeys(element, listShape))
    ) {
      return true;
    }
  }
  return false;
}

/** 400 on any property the contract does not define, at any depth. */
export function assertKnownKeys(value: unknown, shape: KeyShape): void {
  if (hasUnknownKeys(value, shape)) {
    throw invalid();
  }
}

const schemaCache = new WeakMap<EventWindow, ReturnType<typeof createPassFieldsSchema>>();

function passFieldsSchema(window: EventWindow): ReturnType<typeof createPassFieldsSchema> {
  let schema = schemaCache.get(window);
  if (schema === undefined) {
    schema = createPassFieldsSchema(window);
    schemaCache.set(window, schema);
  }
  return schema;
}

function distinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export interface IssuePassesRequest {
  platforms: ('apple' | 'google')[];
  passes: PassFields[];
}

export function parseIssueRequest(body: unknown, window: EventWindow): IssuePassesRequest {
  assertKnownKeys(body, ISSUE_REQUEST_SHAPE);
  const schema = z
    .object({
      platforms: z
        .array(z.enum(['apple', 'google']))
        .min(1)
        .max(2)
        .refine(distinct),
      passes: z.array(passFieldsSchema(window)).min(1).max(25),
    })
    .refine((request) => distinct(request.passes.map((pass) => pass.sessionCode)));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw invalid();
  }
  return parsed.data;
}

export function parsePassFields(body: unknown, window: EventWindow): PassFields {
  assertKnownKeys(body, PASS_FIELDS_SHAPE);
  const parsed = passFieldsSchema(window).safeParse(body);
  if (!parsed.success) {
    throw invalid();
  }
  return parsed.data;
}

export interface CreateHandoffRequest {
  serialNumbers: string[];
  include: { apple: boolean; google: boolean; calendar: boolean };
}

const handoffSchema = z
  .object({
    serialNumbers: z.array(z.string().regex(UUID_V4_PATTERN)).min(1).max(80).refine(distinct),
    include: z.object({ apple: z.boolean(), google: z.boolean(), calendar: z.boolean() }),
  })
  .refine(({ include }) => include.apple || include.google || include.calendar);

export function parseHandoffRequest(body: unknown): CreateHandoffRequest {
  assertKnownKeys(body, HANDOFF_REQUEST_SHAPE);
  const parsed = handoffSchema.safeParse(body);
  if (!parsed.success) {
    throw invalid();
  }
  return parsed.data;
}

const registrationSchema = z.object({ pushToken: z.string().regex(PUSH_TOKEN_PATTERN) });

/** registerDevice lists only 200, 201 and 401, so every failure here is the 401. */
export function parseRegistrationBody(event: ProxyEvent): { pushToken: string } {
  const read = readJson(event);
  if (!read.ok || hasUnknownKeys(read.value, DEVICE_REGISTRATION_SHAPE)) {
    throw new ProblemError(401, 'unauthorized');
  }
  const parsed = registrationSchema.safeParse(read.value);
  if (!parsed.success) {
    throw new ProblemError(401, 'unauthorized');
  }
  return parsed.data;
}

const logSchema = z.object({ logs: z.array(z.string()) });

/**
 * logMessages lists only 200: an unreadable body counts zero. Only the count is returned;
 * the message texts are dropped unread.
 */
export function parseLogBody(event: ProxyEvent): { count: number } {
  const read = readJson(event);
  if (!read.ok || hasUnknownKeys(read.value, LOG_ENTRIES_SHAPE)) {
    return { count: 0 };
  }
  const parsed = logSchema.safeParse(read.value);
  return { count: parsed.success ? parsed.data.logs.length : 0 };
}
