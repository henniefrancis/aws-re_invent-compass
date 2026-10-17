// The injectable seams for time and randomness (design, Seams). Everything else with a
// side effect is injected at its own module.
import { randomBytes, randomUUID } from 'node:crypto';

export interface Clock {
  now(): number;
}

export interface Random {
  bytes(length: number): Uint8Array;
  uuid(): string;
}

export const systemClock: Clock = { now: () => Date.now() };

export const systemRandom: Random = {
  bytes: (length) => new Uint8Array(randomBytes(length)),
  uuid: () => randomUUID(),
};
