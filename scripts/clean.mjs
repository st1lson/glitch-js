import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

for (const pkg of ['core', 'playwright', 'cypress']) {
  rmSync(resolve(import.meta.dirname, '..', 'packages', pkg, 'dist'), { recursive: true, force: true });
}
