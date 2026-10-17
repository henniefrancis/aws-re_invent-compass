// What the API handlers receive: the primitive dependencies plus the services built on them.
import type { PassLifecycle } from '../services/pass-lifecycle.js';
import type { ApiDeps } from './deps.js';

export type ApiContext = ApiDeps & { lifecycle: PassLifecycle };
