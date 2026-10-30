// GET /api/v1/handoffs/{handoffId}/calendar/{serialNumber}.ics: one session as a text/calendar
// file. API Gateway cannot match a suffix on a path variable, so the variable is the whole
// segment ("<serial>.ics") and the suffix is checked here.
import type { ApiContext } from '../../app/context.js';
import { ProblemError } from '../../http/problem.js';
import { binary } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';

const SEGMENT_SUFFIX = '.ics';

export const getHandoffSessionCalendar: Handler<ApiContext> = async (req, ctx) => {
  const segment = req.event.pathParameters?.serialNumber ?? '';
  if (!segment.endsWith(SEGMENT_SUFFIX)) {
    throw new ProblemError(404, 'not_found');
  }
  const text = await ctx.handoffService.sessionCalendar(
    req.event.pathParameters?.handoffId ?? '',
    segment.slice(0, -SEGMENT_SUFFIX.length),
    req,
  );
  return binary(200, 'text/calendar', Buffer.from(text, 'utf8'), {
    'content-disposition': 'attachment; filename="reinvent-session.ics"',
  });
};
