import { createApiApp } from '../app/api-app.js';
import { productionApiDeps } from '../wiring/production-deps.js';

export const handler = createApiApp(productionApiDeps(process.env));
