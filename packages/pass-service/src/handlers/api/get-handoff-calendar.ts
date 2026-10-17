// GET /api/v1/handoffs/{handoffId}/calendar.ics: a text/calendar file.
import type { ApiContext } from '../../app/context.js';
import { binary } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';

export const getHandoffCalendar: Handler<ApiContext> = async (req, ctx) => {
  const text = await ctx.handoffService.calendar(req.event.pathParameters?.handoffId ?? '', req);
  return binary(200, 'text/calendar', Buffer.from(text, 'utf8'), {
    'content-disposition': 'attachment; filename="reinvent.ics"',
  });
};
