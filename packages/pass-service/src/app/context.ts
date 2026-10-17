// What the API handlers receive: the primitive dependencies plus the services built on them.
import type { HandoffService } from '../services/handoff-service.js';
import type { PassLifecycle } from '../services/pass-lifecycle.js';
import type { ApiDeps } from './deps.js';

export type ApiContext = ApiDeps & { lifecycle: PassLifecycle; handoffService: HandoffService };
