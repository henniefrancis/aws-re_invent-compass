// Makes the Node.js type definitions (node:crypto, node:http, node:net, Buffer, URL and
// the timer globals) visible to the auth module. packages/core/tsconfig.json declares no
// "types", and its file list is outside this stream, so the auth module pulls the
// definitions in here with a types reference instead.
/// <reference types="node" />
