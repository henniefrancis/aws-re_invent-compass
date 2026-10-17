import { createPasskitApp } from '../app/passkit-app.js';
import { productionPasskitDeps } from '../wiring/passkit-deps.js';

export const handler = createPasskitApp(productionPasskitDeps(process.env));
