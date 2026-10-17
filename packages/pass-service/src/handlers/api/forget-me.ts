// DELETE /api/v1/me: erase everything the service holds about the caller (Requirement 20,
// review H2 and M3).
//
// Order: read the caller's items, delete them, then fan the voids out (APNs pushes and Google
// INACTIVE patches) from the in-memory copies, within a time budget, best effort. Erasure
// never waits for, or fails because of, the fan-out. Rate_Counters are never deleted, so
// erasing cannot reset a limit. Over the forgetMe limit the data is still erased but the
// fan-out is skipped. Apple passes stay on the phone until they expire (the attendee is told
// to delete them); Google objects go INACTIVE, and Google keeps its own copy.
import type { ApiContext } from '../../app/context.js';
import { RATE_PREFIX, PASS_PREFIX, SUB_PREFIX, isLive } from '../../data/keys.js';
import type { DeviceRegistration, PassRecord } from '../../data/records.js';
import type { Item, Key } from '../../data/table-client.js';
import { header } from '../../http/event.js';
import { json } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { ForgetMeResponseSchema } from '../../validation/response-schemas.js';

/** The index is read until it answers empty twice, at most this many times. */
export const MAX_READ_ROUNDS = 3;

const isCounter = (item: Item): boolean => item.pk.startsWith(RATE_PREFIX);

function keyOf(item: Item): string {
  return `${item.pk}\u0000${item.sk}`;
}

export const forgetMe: Handler<ApiContext> = async (req, ctx) => {
  const caller = await ctx.verifier.verify(header(req.event, 'authorization'));
  const decision = await ctx.limiter.consume(caller.subHash, 'forgetMe', 1, req.now);

  const erased = new Map<string, Item>();
  let empty = 0;
  for (let round = 0; round < MAX_READ_ROUNDS && empty < 2; round += 1) {
    const found = (
      await ctx.table.query({ index: 'GSI2', pk: `${SUB_PREFIX}${caller.subHash}` })
    ).filter((item) => !isCounter(item));
    empty = found.length === 0 ? empty + 1 : 0;
    const keys = new Map<string, Key>();
    for (const item of found) {
      erased.set(keyOf(item), item);
      keys.set(keyOf(item), { pk: item.pk, sk: item.sk });
      if (item.pk.startsWith(PASS_PREFIX)) {
        for (const registration of await ctx.table.query({ index: 'GSI1', pk: item.pk })) {
          erased.set(keyOf(registration), registration);
          keys.set(keyOf(registration), { pk: registration.pk, sk: registration.sk });
        }
      }
    }
    // A registration comes back from both indexes; DynamoDB rejects duplicate keys in a batch.
    await ctx.table.batchDelete([...keys.values()]);
  }

  const items = [...erased.values()];
  const passes = items
    .filter((item) => item.pk.startsWith(PASS_PREFIX) && item.sk === 'PASS')
    .map((item) => item as unknown as PassRecord);
  const voidable = passes.filter((rec) => rec.status === 'active' && isLive(rec, req.now));
  const registrations = items
    .filter((item) => item.pk.startsWith('DEV#'))
    .map((item) => item as unknown as DeviceRegistration)
    .filter((registration) => isLive(registration, req.now));

  if (decision.allowed && voidable.length > 0) {
    const fanOut = Promise.allSettled(
      voidable.map((rec) =>
        ctx.lifecycle.fanOutVoid(
          rec,
          registrations.filter((registration) => registration.serialNumber === rec.serialNumber),
          req,
          false,
        ),
      ),
    );
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ctx.config.apns.budgetMs * 2);
    });
    try {
      await Promise.race([fanOut, budget]);
    } finally {
      clearTimeout(timer);
    }
  }

  return json(
    202,
    ForgetMeResponseSchema.parse({ voided: voidable.length, deleted: items.length }),
  );
};
