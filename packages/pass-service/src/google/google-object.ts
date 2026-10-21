// The Google Wallet generic object built from PassFields (Requirement 14.1). Pure.
//
// Field names follow the GenericObject reference: `cardTitle`, `header` and `subheader` are
// LocalizedString values, `textModulesData` holds TextModuleData entries, `validTimeInterval`
// is a TimeInterval of DateTime values. No `barcode` and no `logo` are set (an image needs a
// public URL; Google then shows the first letter of the card title).
// https://developers.google.com/wallet/generic/rest/v1/genericobject
import type { PassFields } from '@compass/contracts';
import { formatEventDate, formatEventTime24 } from '../apple/format-time.js';
import {
  DISCLAIMER,
  NO_ROOM,
  NO_VENUE,
  boardingClosesAt,
  shortRoom,
} from '../apple/pass-template.js';

/** The Apple pass background (PASS_COLOURS, rgb(0, 0, 0)) as Google hex (tasks 40 and 44). */
export const GOOGLE_BACKGROUND = '#000000';

export type GoogleObjectState = 'ACTIVE' | 'INACTIVE';

export interface LocalizedString {
  defaultValue: { language: string; value: string };
}

export interface TextModule {
  id: string;
  header: string;
  body: string;
}

export interface GenericObject {
  id: string;
  classId: string;
  state: GoogleObjectState;
  cardTitle: LocalizedString;
  header: LocalizedString;
  subheader: LocalizedString;
  textModulesData: TextModule[];
  hexBackgroundColor: string;
  validTimeInterval: { end: { date: string } };
}

export interface GenericObjectInput {
  serialNumber: string;
  fields: PassFields;
  state: GoogleObjectState;
  timezone: string;
}

function localized(value: string): LocalizedString {
  return { defaultValue: { language: 'en-US', value } };
}

export function googleObjectId(issuerId: string, serialNumber: string): string {
  return `${issuerId}.${serialNumber}`;
}

export function buildGenericObject(
  input: GenericObjectInput,
  google: { issuerId: string; classSuffix: string },
): GenericObject {
  const { fields, timezone } = input;
  return {
    id: googleObjectId(google.issuerId, input.serialNumber),
    classId: `${google.issuerId}.${google.classSuffix}`,
    state: input.state,
    cardTitle: localized('Compass boarding pass'),
    header: localized(fields.title),
    subheader: localized(fields.sessionCode),
    // The same fields and formats as the Apple pass (task 40).
    textModulesData: [
      { id: 'terminal', header: 'TERMINAL', body: fields.venue === '' ? NO_VENUE : fields.venue },
      {
        id: 'gate',
        header: 'GATE',
        body: shortRoom(fields.room) === '' ? NO_ROOM : shortRoom(fields.room),
      },
      {
        id: 'date',
        header: 'DATE',
        body: `${formatEventDate(fields.startsAt, timezone)} | ${formatEventTime24(fields.startsAt, timezone)}-${formatEventTime24(fields.endsAt, timezone)}`,
      },
      {
        id: 'boardingCloses',
        header: 'BOARDING CLOSES',
        body: formatEventTime24(boardingClosesAt(fields.startsAt), timezone),
      },
      ...(fields.room === '' ? [] : [{ id: 'room', header: 'ROOM', body: fields.room }]),
      { id: 'notice', header: 'NOTICE', body: DISCLAIMER },
    ],
    hexBackgroundColor: GOOGLE_BACKGROUND,
    validTimeInterval: { end: { date: fields.endsAt } },
  };
}
