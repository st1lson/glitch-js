// Writes the module-type marker into each build output directory so Node
// resolves dist/esm as ESM and dist/cjs as CommonJS, regardless of what the
// owning package.json declares. Keeps the dual build free of a bundler.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.', 'dist');

for (const [dir, type] of [
  ['esm', 'module'],
  ['cjs', 'commonjs'],
]) {
  const target = join(root, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}
