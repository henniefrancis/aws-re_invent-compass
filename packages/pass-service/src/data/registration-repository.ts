// Device_Registration storage. Each registration is stored twice in the base table: under its
// device (DEV#<deviceHash>, for the device's list) and under its pass (PASSREG#<serial>, a copy
// that is counted and listed with strongly consistent queries). At most
// MAX_REGISTRATIONS_PER_PASS live registrations are kept per pass (review H3 and N7): a new
// device writes its items, counts again, and takes them back if the pass is then over the cap,
// so two registrations that race can never both stay over it.
import {
  DEVICE_PREFIX,
  PASSREG_PREFIX,
  REGISTRATION_PREFIX,
  SUB_PREFIX,
  isLive,
  passRegistrationKey,
  registrationKey,
  ttlOf,
} from './keys.js';
import type { DeviceRegistration } from './records.js';
import type { Item, TableClient } from './table-client.js';

export const MAX_REGISTRATIONS_PER_PASS = 10;

export interface RegistrationRepository {
  get(deviceHash: string, serial: string, now: number): Promise<DeviceRegistration | undefined>;
  /** Stores or replaces. 'full' (nothing stored) when a new device would pass the cap. */
  register(reg: DeviceRegistration, now: number): Promise<'created' | 'updated' | 'full'>;
  delete(deviceHash: string, serial: string): Promise<boolean>;
  listByDevice(
    deviceHash: string,
    passTypeIdentifier: string,
    now: number,
  ): Promise<DeviceRegistration[]>;
  /** Live registrations of one pass, at most MAX_REGISTRATIONS_PER_PASS. */
  listByPass(serial: string, now: number): Promise<DeviceRegistration[]>;
  extendExpiry(serial: string, expiresAtMs: number, now: number): Promise<void>;
}

const INDEX_ATTRIBUTES = ['pk', 'sk', 'gsi2pk', 'gsi2sk'];

function deviceItem(reg: DeviceRegistration): Item {
  return {
    ...reg,
    ...registrationKey(reg.deviceHash, reg.serialNumber),
    ttl: ttlOf(reg.expiresAtMs),
    gsi2pk: `${SUB_PREFIX}${reg.subHash}`,
    gsi2sk: `${REGISTRATION_PREFIX}${reg.deviceHash}#${reg.serialNumber}`,
  };
}

function passItem(reg: DeviceRegistration): Item {
  return {
    ...reg,
    ...passRegistrationKey(reg.serialNumber, reg.deviceHash),
    ttl: ttlOf(reg.expiresAtMs),
    gsi2pk: `${SUB_PREFIX}${reg.subHash}`,
    gsi2sk: `${PASSREG_PREFIX}${reg.serialNumber}#${reg.deviceHash}`,
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
  async function liveOfPass(serial: string, now: number): Promise<DeviceRegistration[]> {
    const items = await table.query({ pk: `${PASSREG_PREFIX}${serial}` });
    return items.filter((item) => isLive(item, now)).map(fromItem);
  }

  async function write(reg: DeviceRegistration): Promise<void> {
    await table.put(deviceItem(reg));
    await table.put(passItem(reg));
  }

  async function remove(deviceHash: string, serial: string): Promise<boolean> {
    await table.delete(passRegistrationKey(serial, deviceHash));
    return table.delete(registrationKey(deviceHash, serial));
  }

  return {
    async get(deviceHash, serial, now) {
      const item = await table.get(registrationKey(deviceHash, serial));
      return item !== undefined && isLive(item, now) ? fromItem(item) : undefined;
    },

    async register(reg, now) {
      const existing = await table.get(registrationKey(reg.deviceHash, reg.serialNumber));
      const known = existing !== undefined && isLive(existing, now);
      await write(reg);
      if (known) {
        return 'updated';
      }
      if ((await liveOfPass(reg.serialNumber, now)).length > MAX_REGISTRATIONS_PER_PASS) {
        await remove(reg.deviceHash, reg.serialNumber);
        return 'full';
      }
      return 'created';
    },

    delete: remove,

    async listByDevice(deviceHash, passTypeIdentifier, now) {
      const items = await table.query({
        pk: `${DEVICE_PREFIX}${deviceHash}`,
        skPrefix: REGISTRATION_PREFIX,
      });
      return items
        .filter((item) => isLive(item, now) && item.passTypeIdentifier === passTypeIdentifier)
        .map(fromItem);
    },

    async listByPass(serial, now) {
      return (await liveOfPass(serial, now)).slice(0, MAX_REGISTRATIONS_PER_PASS);
    },

    async extendExpiry(serial, expiresAtMs, now) {
      for (const reg of (await liveOfPass(serial, now)).slice(0, MAX_REGISTRATIONS_PER_PASS)) {
        await write({ ...reg, expiresAtMs });
      }
    },
  };
}
