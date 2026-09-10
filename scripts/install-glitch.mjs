import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const BIN_DIR = join(REPO_ROOT, '.glitch');
const MODULE = 'github.com/st1lson/glitch/cmd/glitch';

const version = process.env.GLITCH_VERSION ?? 'latest';

function goIsAvailable() {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!goIsAvailable()) {
  console.error(
    'The Go toolchain is required to build the Glitch server the integration suite runs against.\n' +
      'Install Go from https://go.dev/dl, or set GLITCH_BIN to a binary you already have.',
  );
  process.exit(1);
}

mkdirSync(BIN_DIR, { recursive: true });

console.log(`Installing ${MODULE}@${version} into ${BIN_DIR}`);
execFileSync('go', ['install', `${MODULE}@${version}`], {
  stdio: 'inherit',
  env: { ...process.env, GOBIN: BIN_DIR },
});

const installed = ['glitch.exe', 'glitch'].map((name) => join(BIN_DIR, name)).find(existsSync);
if (!installed) {
  console.error(`go install reported success but no binary landed in ${BIN_DIR}`);
  process.exit(1);
}

console.log(`Installed ${installed}`);
