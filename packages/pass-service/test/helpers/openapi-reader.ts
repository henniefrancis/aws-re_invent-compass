// A small indentation-based reader of contracts/compass-api.openapi.yaml (no YAML
// dependency). It builds a tree of keys, which is all the conformance tests need: schema
// property names, paths, methods, operation ids and response statuses. Block scalars and
// list items are skipped; only `key:` lines are read.
import { readFileSync } from 'node:fs';

export interface YNode {
  /** The text after the colon on the key line (may be empty). */
  value: string;
  children: Record<string, YNode>;
}

const KEY_LINE = /^( *)('[^']*'|"[^"]*"|[^\s:#'"-][^:]*?|-[^\s:][^:]*?):(?:\s+(.*))?$/;

export function parseYamlTree(text: string): YNode {
  const root: YNode = { value: '', children: {} };
  const stack: { indent: number; node: YNode }[] = [{ indent: -1, node: root }];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#') || line.trim().startsWith('- ')) {
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const indent = (match[1] ?? '').length;
    const key = (match[2] ?? '').replace(/^['"]|['"]$/g, '');
    while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? -1) >= indent) {
      stack.pop();
    }
    const node: YNode = { value: (match[3] ?? '').trim(), children: {} };
    const parent = stack[stack.length - 1]?.node ?? root;
    parent.children[key] = node;
    stack.push({ indent, node });
  }
  return root;
}

export function loadContractTree(): YNode {
  const url = new URL('../../../../contracts/compass-api.openapi.yaml', import.meta.url);
  return parseYamlTree(readFileSync(url, 'utf8'));
}

/** Walks a key path; throws when a key is missing so a typo cannot pass silently. */
export function at(node: YNode, ...path: string[]): YNode {
  let current = node;
  for (const key of path) {
    const next = current.children[key];
    if (next === undefined) {
      throw new Error(`contract key not found: ${path.join('.')}`);
    }
    current = next;
  }
  return current;
}

/** The property names of a component schema, optionally of a nested object property. */
export function schemaKeys(tree: YNode, schema: string, ...nested: string[]): string[] {
  let node = at(tree, 'components', 'schemas', schema);
  for (const property of nested) {
    node = at(node, 'properties', property);
  }
  return Object.keys(at(node, 'properties').children);
}

export const HTTP_METHODS = ['get', 'put', 'post', 'delete'] as const;

export interface ContractOperation {
  path: string;
  method: (typeof HTTP_METHODS)[number];
  operationId: string;
  statuses: number[];
}

/** Every operation of the contract with its path, method, operationId and response statuses. */
export function contractOperations(tree: YNode): ContractOperation[] {
  const operations: ContractOperation[] = [];
  for (const [path, pathNode] of Object.entries(at(tree, 'paths').children)) {
    for (const method of HTTP_METHODS) {
      const operation = pathNode.children[method];
      if (operation !== undefined) {
        operations.push({
          path,
          method,
          operationId: at(operation, 'operationId').value,
          statuses: Object.keys(at(operation, 'responses').children).map(Number),
        });
      }
    }
  }
  return operations;
}

/** The media types a response declares. A `$ref` response is one of the shared Problem responses. */
export function responseContentTypes(
  tree: YNode,
  path: string,
  method: string,
  status: number,
): string[] {
  const response = at(tree, 'paths', path, method, 'responses', String(status));
  if (response.children.$ref !== undefined) {
    return ['application/problem+json'];
  }
  return Object.keys(response.children.content?.children ?? {});
}
