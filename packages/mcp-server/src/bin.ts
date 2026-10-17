#!/usr/bin/env node
// The only file excluded from coverage. It passes the process values to `main` and sets the exit
// code; everything else is tested in `cli/main.ts`.
import { main } from './cli/main.js';

process.exitCode = await main({
  argv: process.argv.slice(2),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
