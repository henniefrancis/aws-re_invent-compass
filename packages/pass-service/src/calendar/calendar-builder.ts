// The hand-off calendar: one VEVENT per pass, UTC times, UID equal to the serial number,
// and a display alarm at boarding closes (10 minutes before the start). RFC 5545.
import type { PassFields } from '@compass/contracts';
import ical, { ICalAlarmType } from 'ical-generator';
import { formatEventTime } from '../apple/format-time.js';
import { DISCLAIMER, NO_VENUE, boardingClosesAt } from '../apple/pass-template.js';

const BOARDING_CLOSES_SECONDS = 600;

export interface CalendarPass {
  serialNumber: string;
  fields: PassFields;
}

export function buildCalendar(
  passes: readonly CalendarPass[],
  timezone: string,
  nowMs: number,
): string {
  const calendar = ical({ prodId: { company: 're:Invent Compass', product: 'boarding passes' } });
  for (const { serialNumber, fields } of passes) {
    const location = [fields.venue === '' ? NO_VENUE : fields.venue, fields.room]
      .filter((part) => part !== '')
      .join(', ');
    const event = calendar.createEvent({
      id: serialNumber,
      // From the injected clock, so the file is the same every time (review L5).
      stamp: new Date(nowMs),
      start: new Date(Date.parse(fields.startsAt)),
      end: new Date(Date.parse(fields.endsAt)),
      summary: `${fields.sessionCode} ${fields.title}`,
      location,
      description: `Boarding closes ${formatEventTime(boardingClosesAt(fields.startsAt), timezone)}. ${DISCLAIMER}`,
    });
    event.createAlarm({
      type: ICalAlarmType.display,
      trigger: BOARDING_CLOSES_SECONDS,
      description: `Boarding closes soon for ${fields.sessionCode}`,
    });
  }
  return calendar.toString();
}
