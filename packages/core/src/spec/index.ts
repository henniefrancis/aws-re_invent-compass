// @compass/core/spec entry point (S3): the week planner, the week spec renderer and the
// spec writer. The public surface is exported by name; there is no barrel of barrels.
export type { SpecFs } from './spec-fs.js';
export { eventDay, planWeek } from './planner.js';
export type {
  LayoverPick,
  PlanResult,
  PlannerFinding,
  PlannerInput,
  PlannerRules,
  PlannerSession,
  Pick,
} from './planner.js';
export { formatLocal, renderWeekSpec, sanitiseCatalogText } from './render.js';
export type { ConnectionLine, EnergyLine, WeekSpecFiles, WeekSpecInput } from './render.js';
