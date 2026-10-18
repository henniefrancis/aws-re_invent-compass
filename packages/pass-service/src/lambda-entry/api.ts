import { createApiApp } from '../app/api-app.js';
import { productionApiDeps } from '../wiring/api-deps.js';

export const handler = createApiApp(productionApiDeps(process.env));
