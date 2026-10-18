// The Terraform detector (Requirements 2.1 and 2.6): counts each `resource` or `data`
// block whose type starts with `aws_`. Whole-line `#` and `//` comments are ignored.
// Hits carry the Terraform type and a count, no location.

import { addHit, codeLines, grp } from './text.js';
import type { Detector, DetectorHit } from './types.js';

const BLOCK = /^\s*(?:resource|data)\s+"(aws_[a-z0-9_]+)"/;

export const terraformDetector: Detector = {
  id: 'terraform',
  accepts: (fileName) => fileName.endsWith('.tf'),
  detect: (text) => {
    const hits: DetectorHit[] = [];
    for (const line of codeLines(text, ['#', '//'])) {
      const match = BLOCK.exec(line);
      if (match !== null) {
        addHit(hits, {
          identifierKind: 'terraformType',
          identifier: grp(match, 1),
          kind: 'terraformResources',
          count: 1,
        });
      }
    }
    return hits;
  },
};
