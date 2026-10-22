// The Google Wallet generic object built from PassFields (Requirement 14.1). Pure.
//
// Field names follow the GenericObject reference: `cardTitle`, `header` and `subheader` are
// LocalizedString values, `textModulesData` holds TextModuleData entries, `wideLogo` and
// `heroImage` are Image values, `validTimeInterval` is a TimeInterval of DateTime values. No
// `barcode` is set. The class template (scripts/google-wallet-class.mjs) puts the terminal and
// gate, then the date and boarding closes on the front and orders the details (task 47).
// https://developers.google.com/wallet/generic/rest/v1/genericobject
// https://developers.google.com/wallet/generic/resources/template
import type { PassFields } from '@compass/contracts';
import { formatEventDate, formatEventTime24 } from '../apple/format-time.js';
import {
  NO_ROOM,
  NO_VENUE,
  backFields,
  boardingClosesAt,
  shortRoom,
} from '../apple/pass-template.js';
import { GOOGLE_DETAIL_MODULES, GOOGLE_IMAGES, GOOGLE_IMAGE_PATH } from './google-layout.js';

/**
 * The blue at the top of the hero image, so the card runs into the picture (task 47). White
 * text measures about 7.9:1 on it. The Apple pass stays black.
 */
export const GOOGLE_BACKGROUND = '#2035E2';

export type GoogleObjectState = 'ACTIVE' | 'INACTIVE';

export interface LocalizedString {
  defaultValue: { language: string; value: string };
}

export interface TextModule {
  id: string;
  header: string;
  body: string;
}

export interface GoogleImage {
  sourceUri: { uri: string };
  contentDescription: LocalizedString;
}

export interface GenericObject {
  id: string;
  classId: string;
  state: GoogleObjectState;
  cardTitle: LocalizedString;
  header: LocalizedString;
  subheader: LocalizedString;
  wideLogo: GoogleImage;
  heroImage: GoogleImage;
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

function image(publicBaseUrl: string, file: string, description: string): GoogleImage {
  return {
    sourceUri: { uri: `${publicBaseUrl}${GOOGLE_IMAGE_PATH}${file}` },
    contentDescription: localized(description),
  };
}

export function googleObjectId(issuerId: string, serialNumber: string): string {
  return `${issuerId}.${serialNumber}`;
}

export function buildGenericObject(
  input: GenericObjectInput,
  google: { issuerId: string; classSuffix: string; publicBaseUrl: string },
): GenericObject {
  const { fields, timezone } = input;
  const back = new Map(backFields(fields, timezone).map((field) => [field.key, field]));
  const details = GOOGLE_DETAIL_MODULES.flatMap((id) => {
    const field = back.get(id);
    // Every back field has a label; only the unlabelled arrow is not a back field.
    return field === undefined ? [] : [{ id, header: field.label as string, body: field.value }];
  });
  return {
    id: googleObjectId(google.issuerId, input.serialNumber),
    classId: `${google.issuerId}.${google.classSuffix}`,
    state: input.state,
    cardTitle: localized('Compass boarding pass'),
    header: localized(fields.title),
    subheader: localized(fields.sessionCode),
    wideLogo: image(google.publicBaseUrl, GOOGLE_IMAGES.wideLogo, 'Compass icon'),
    heroImage: image(
      google.publicBaseUrl,
      GOOGLE_IMAGES.hero,
      're:Invent Compass logo on a blue to pink gradient',
    ),
    // The front rows (GOOGLE_FRONT_ROWS) hold the Apple pass's secondary and auxiliary fields
    // (tasks 40 and 47); the details follow.
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
      ...details,
    ],
    hexBackgroundColor: GOOGLE_BACKGROUND,
    validTimeInterval: { end: { date: fields.endsAt } },
  };
}
