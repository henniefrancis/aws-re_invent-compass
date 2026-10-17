import { describe, expect, test } from 'vitest';
import * as simulated from '../../src/simulated/index.js';

// Structural export test for the simulated entry point (events-client, S1, task 16.1).
// The list is explicit so the public surface changes only on purpose.

const EXPECTED = [
  'createFsFixtureLoader',
  'createInMemorySchedule',
  'createSimulatedTransport',
  'defaultFixturesRoot',
  'operationFolder',
];

describe('events-client, task 16.1: the simulated entry point', () => {
  test('exports exactly the listed runtime names', () => {
    expect(Object.keys(simulated).sort()).toEqual([...EXPECTED].sort());
  });
});
