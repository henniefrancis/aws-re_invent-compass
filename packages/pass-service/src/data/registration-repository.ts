// Device_Registration storage. At most MAX_REGISTRATIONS_PER_PASS live registrations are
// considered per pass (security review H3): the register handler refuses to store more,
// and listByPass never returns more.
import {
  DEVICE_PREFIX,
  PASS_PREFIX,
  REGISTRATION_PREFIX,
  SUB_PREFIX,
  isLive,
  registrationKey,
  ttlOf,
} from './keys.js';
import type { DeviceRegistration } from './records.js';
import type { Item, TableClient } from './table-client.js';

export const MAX_REGISTRATIONS_PER_PASS = 10;

export interface RegistrationRepository {
  get(deviceHash: string, serial: string, now: number): Promise<DeviceRegistration | undefined>;
  upsert(reg: DeviceRegistration, now: number): Promise<'created' | 'updated'>;
  delete(deviceHash: string, serial: string): Promise<boolean>;
  listByDevice(
    deviceHash: string,
    passTypeIdentifier: string,
    now: number,
  ): Promise<DeviceRegistration[]>;
  /** Live registrations of one pass through GSI1, at most MAX_REGISTRATIONS_PER_PASS. */
  listByPass(serial: string, now: number): Promise<DeviceRegistration[]>;
  extendExpiry(serial: string, expiresAtMs: number, now: number): Promise<void>;
}

const INDEX_ATTRIBUTES = ['pk', 'sk', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk'];

function toItem(reg: DeviceRegistration): Item {
  return {
    ...reg,
    ...registrationKey(reg.deviceHash, reg.serialNumber),
    ttl: ttlOf(reg.expiresAtMs),
    gsi1pk: `${PASS_PREFIX}${reg.serialNumber}`,
    gsi1sk: `${DEVICE_PREFIX}${reg.deviceHash}`,
    gsi2pk: `${SUB_PREFIX}${reg.subHash}`,
    gsi2sk: `${REGISTRATION_PREFIX}${reg.deviceHash}#${reg.serialNumber}`,
  };
}

function fromItem(item: Item): DeviceRegistration {
  const plain: Record<string, unknown> = { ...item };
  for (const attribute of INDEX_ATTRIBUTES) {
    delete plain[attribute];
  }
  return plain as unknown as DeviceRegistration;
}

export function createRegistrationRepository(table: TableClient): RegistrationRepository {
  async function liveByPass(serial: string, now: number): Promise<DeviceRegistration[]> {
    const items = await table.query({ index: 'GSI1', pk: `${PASS_PREFIX}${serial}` });
    return items
      .filter((item) => isLive(item, now))
      .map(fromItem)
      .slice(0, MAX_REGISTRATIONS_PER_PASS);
  }

  return {
    async get(deviceHash, serial, now) {
      const item = await table.get(registrationKey(deviceHash, serial));
      return item !== undefined && isLive(item, now) ? fromItem(item) : undefined;
    },

    async upsert(reg, now) {
      const existing = await table.get(registrationKey(reg.deviceHash, reg.serialNumber));
      await table.put(toItem(reg));
      return existing !== undefined && isLive(existing, now) ? 'updated' : 'created';
    },

    async delete(deviceHash, serial) {
      return table.delete(registrationKey(deviceHash, serial));
    },

    async listByDevice(deviceHash, passTypeIdentifier, now) {
      const items = await table.query({
        pk: `${DEVICE_PREFIX}${deviceHash}`,
        skPrefix: REGISTRATION_PREFIX,
      });
      return items
        .filter((item) => isLive(item, now) && item.passTypeIdentifier === passTypeIdentifier)
        .map(fromItem);
    },

    listByPass: liveByPass,

    async extendExpiry(serial, expiresAtMs, now) {
      for (const reg of await liveByPass(serial, now)) {
        await table.set(registrationKey(reg.deviceHash, reg.serialNumber), {
          expiresAtMs,
          ttl: ttlOf(expiresAtMs),
        });
      }
    },
  };
}
