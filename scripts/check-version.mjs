import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const PACKAGES = ['core', 'playwright'];

const expected = process.argv[2];
if (!expected) {
  console.error('Usage: node scripts/check-version.mjs <version>');
  process.exit(1);
}

const problems = [];

for (const pkg of PACKAGES) {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf8'));

  if (manifest.version !== expected) {
    problems.push(`${manifest.name} is at ${manifest.version}, expected ${expected}`);
  }

  // The adapters pin core exactly, so a release that bumps one and not the
  // other installs a core that has never been tested against it.
  const pinned = manifest.dependencies?.['glitch-core'];
  if (pinned && pinned !== expected) {
    problems.push(`${manifest.name} depends on glitch-core@${pinned}, expected ${expected}`);
  }
}

if (problems.length > 0) {
  console.error(`Version mismatch:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

console.log(`every package is at ${expected}`);
