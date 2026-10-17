// @compass/core/simulated entry point (events-client, S1).
//
// The fixture-backed transport used when COMPASS_MODE=simulated: it presents a
// signed-in attendee, serves the synthetic catalog and canned responses, keeps an
// in-memory schedule and never touches the network.

export {
  createSimulatedTransport,
  SimulatedScenarioError,
  type SimulatedConfig,
} from './simulated-transport.js';
export {
  createFsFixtureLoader,
  defaultFixturesRoot,
  operationFolder,
  type FixtureFile,
  type FixtureLoader,
  type ReadText,
} from './fixtures.js';
export {
  createInMemorySchedule,
  type InMemorySchedule,
  type ScheduleWorld,
} from './in-memory-schedule.js';
export { createSimulatedCredential, SIMULATED_ACCESS_TOKEN } from './simulated-credential.js';
