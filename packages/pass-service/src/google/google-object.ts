// The Google Wallet generic object built from PassFields (Requirement 14.1). Pure.
//
// Field names follow the GenericObject reference: `cardTitle`, `header` and `subheader` are
// LocalizedString values, `textModulesData` holds TextModuleData entries, `validTimeInterval`
// is a TimeInterval of DateTime values. No `barcode` and no `logo` are set (an image needs a
// public URL; Google then shows the first letter of the card title).
// https://developers.google.com/wallet/generic/rest/v1/genericobject
import type { PassFields } from '@compass/contracts';
import { formatEventDayTime, formatEventTime } from '../apple/format-time.js';
import { DISCLAIMER, NO_VENUE, boardingClosesAt } from '../apple/pass-template.js';

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
    textModulesData: [
      { id: 'gate', header: 'Gate', body: fields.venue === '' ? NO_VENUE : fields.venue },
      {
        id: 'boardingCloses',
        header: 'Boarding closes',
        body: formatEventTime(boardingClosesAt(fields.startsAt), timezone),
      },
      { id: 'starts', header: 'Starts', body: formatEventDayTime(fields.startsAt, timezone) },
      { id: 'notice', header: 'Notice', body: DISCLAIMER },
    ],
    hexBackgroundColor: '#0e3e4a',
    validTimeInterval: { end: { date: fields.endsAt } },
  };
}
