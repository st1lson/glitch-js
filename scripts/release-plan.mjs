/**
 * Decides which workspace packages a release should publish.
 *
 * The manifest version is the source of truth: a package ships only when its
 * version is not already on the registry. That is what lets a fix to one
 * adapter go out without dragging every other package along with it.
 *
 * Usage:
 *   node scripts/release-plan.mjs            print the plan, fail if empty
 *   node scripts/release-plan.mjs --names    publish order, one name per line
 *   node scripts/release-plan.mjs --specs    same, as name@version
 *   node scripts/release-plan.mjs --stage    stage everything the plan selects
 *   node scripts/release-plan.mjs --json     the full plan as JSON
 */
import { execFileSync, execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const isWindows = process.platform === 'win32';

function npm(args, overrides = {}) {
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...overrides };
  if (!isWindows) return execFileSync('npm', args, options);

  // Node refuses to spawn a .cmd shim without a shell, and npm on Windows is one.
  return execSync(['npm', ...args].join(' '), options);
}

function readManifests() {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(PACKAGES_DIR, entry.name);
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      return { dir: entry.name, name: manifest.name, version: manifest.version, manifest };
    })
    .filter((pkg) => pkg.manifest.private !== true);
}

/** Versions already on the registry. A package nobody has published yet has none. */
function publishedVersions(name) {
  try {
    return JSON.parse(npm(['view', name, 'versions', '--json']));
  } catch {
    return [];
  }
}

/** Orders packages so a dependency is always published before its dependents. */
function inDependencyOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const ordered = [];
  const seen = new Set();

  const visit = (pkg) => {
    if (seen.has(pkg.name)) return;
    seen.add(pkg.name);

    for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
      const local = byName.get(dependency);
      if (local) visit(local);
    }

    ordered.push(pkg);
  };

  for (const pkg of packages) visit(pkg);
  return ordered;
}

const packages = inDependencyOrder(readManifests());

const plan = packages.map((pkg) => {
  const versions = publishedVersions(pkg.name);
  const published = versions.includes(pkg.version);

  return {
    name: pkg.name,
    version: pkg.version,
    publish: !published,
    reason: published ? 'already on the registry' : versions.length === 0 ? 'first release' : 'new version',
  };
});

const toPublish = plan.filter((entry) => entry.publish);

if (process.argv.includes('--names')) {
  for (const entry of toPublish) console.log(entry.name);
  process.exit(0);
}

if (process.argv.includes('--specs')) {
  for (const entry of toPublish) console.log(`${entry.name}@${entry.version}`);
  process.exit(0);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ publish: toPublish, skip: plan.filter((e) => !e.publish) }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--stage')) {
  if (toPublish.length === 0) {
    console.error('Nothing to stage. Bump a version in packages/*/package.json first.');
    process.exit(1);
  }

  for (const entry of toPublish) {
    console.log(`\nstaging ${entry.name}@${entry.version}`);
    npm(['stage', 'publish', '--workspace', entry.name], { stdio: 'inherit' });
  }

  console.log('\nStaged. Nothing is installable until a maintainer promotes it:\n');
  console.log('  npm stage list');
  console.log('  npm stage approve <stage-id>');
  process.exit(0);
}

for (const entry of plan) {
  const mark = entry.publish ? 'publish' : 'skip   ';
  console.log(`${mark}  ${entry.name}@${entry.version}  (${entry.reason})`);
}

if (toPublish.length === 0) {
  console.error('\nNothing to publish. Bump a version in packages/*/package.json before tagging.');
  process.exit(1);
}
