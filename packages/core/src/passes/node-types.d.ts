// Ambient Node.js types for the pass side (boarding-passes, S4).
//
// TypeScript 6 no longer includes every @types package by default, and the
// packages/core tsconfig does not list node in its types field. The pass side uses
// node:crypto, node:path and node:http, so this declaration file pulls the Node types
// into the program. It holds no runtime code.
/// <reference types="node" />
