import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const PACKAGES = ['core', 'playwright'];

const isWindows = process.platform === 'win32';

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options })?.trim() ?? '';
}

// Node refuses to spawn a .cmd shim without a shell, and npm on Windows is one,
// so that platform goes through execSync with a single quoted command string.
function npm(args, options = {}) {
  if (!isWindows) return run('npm', args, options);

  const command = ['npm', ...args].map((arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg)).join(' ');
  return execSync(command, { encoding: 'utf8', ...options })?.trim() ?? '';
}

const staging = mkdtempSync(join(tmpdir(), 'glitch-js-pack-'));
const tarballs = new Map();

for (const pkg of PACKAGES) {
  const dir = join(REPO_ROOT, 'packages', pkg);
  const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name;
  const file = npm(['pack', '--pack-destination', staging, '--silent'], { cwd: dir }).split('\n').pop();

  tarballs.set(name, join(staging, file));
  console.log(`packed ${name} -> ${file}`);
}

const consumer = mkdtempSync(join(tmpdir(), 'glitch-js-consumer-'));
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true }, null, 2));

npm(['install', '--no-audit', '--no-fund', ...tarballs.values(), '@playwright/test'], {
  cwd: consumer,
  stdio: 'inherit',
});

// Both module systems resolve through the exports map, so a mistake in either
// half shows up here rather than in a user's project.
const esm = `
import { GlitchClient } from 'glitch-core';
import { glitchFixtures, test } from 'glitch-playwright';
if (typeof GlitchClient !== 'function') throw new Error('GlitchClient missing from the ESM build');
if (typeof glitchFixtures !== 'function') throw new Error('glitchFixtures missing from the ESM build');
if (typeof test !== 'function') throw new Error('test missing from the ESM build');
console.log('esm ok');
`;

const cjs = `
const { GlitchClient } = require('glitch-core');
const { glitchFixtures, test } = require('glitch-playwright');
if (typeof GlitchClient !== 'function') throw new Error('GlitchClient missing from the CJS build');
if (typeof glitchFixtures !== 'function') throw new Error('glitchFixtures missing from the CJS build');
if (typeof test !== 'function') throw new Error('test missing from the CJS build');
console.log('cjs ok');
`;

writeFileSync(join(consumer, 'check.mjs'), esm);
writeFileSync(join(consumer, 'check.cjs'), cjs);

run(process.execPath, ['check.mjs'], { cwd: consumer, stdio: 'inherit' });
run(process.execPath, ['check.cjs'], { cwd: consumer, stdio: 'inherit' });

console.log('every package resolves as both ESM and CommonJS');
