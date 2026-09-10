# glitch-js

[![glitch-core](https://img.shields.io/npm/v/glitch-core?logo=npm&label=glitch-core&color=cb3837)](https://www.npmjs.com/package/glitch-core)
[![glitch-playwright](https://img.shields.io/npm/v/glitch-playwright?logo=npm&label=glitch-playwright&color=cb3837)](https://www.npmjs.com/package/glitch-playwright)
[![CI](https://github.com/st1lson/glitch-js/actions/workflows/ci.yml/badge.svg)](https://github.com/st1lson/glitch-js/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

JavaScript and TypeScript SDKs for [Glitch](https://github.com/st1lson/glitch), an API chaos-engineering interceptor.

Glitch lets you break your backend on purpose from inside a test, then verify that your app handles the failure correctly. Each test gets its own isolated chaos scenario, so your test suite can still run safely in parallel.

```ts
import { expect, test } from 'glitch-playwright';

test('shows an error toast when the API fails', async ({ page, glitch }) => {
  await glitch.fail(500);

  await page.goto('/dashboard');

  await expect(page.getByRole('alert')).toHaveText('Something went wrong');
});
```

## Packages

| Package                                             | Description                                   | Dependencies             |
| --------------------------------------------------- | --------------------------------------------- | ------------------------ |
| [`glitch-core`](packages/core)             | Framework-agnostic client for the control API | none                     |
| [`glitch-playwright`](packages/playwright) | Playwright fixtures                           | core, Playwright as peer |

For most projects, the framework integration is the easiest place to start. Use core directly if you're driving Glitch from a script, a custom test runner, or a framework that doesn't have an adapter yet.

```bash
npm install --save-dev glitch-playwright
```

Requires Node 20.11 or newer. Both packages ship ESM and CommonJS builds.

Contributing to the repo itself needs Node 22.18 or newer, since the tests run TypeScript sources directly.

## Why it is split this way

Core is deliberately split into two layers.

`buildRequest` is pure and synchronous. It takes an operation and returns a plain `{ method, url, headers, body }` descriptor without doing any I/O.

`GlitchClient` adds a swappable transport on top of that, using the global `fetch` by default.

That distinction matters for framework integrations. The Playwright adapter uses the promise-based client with Playwright's own request context, which means Glitch control calls show up in traces alongside the requests they affect.

A Cypress adapter, on the other hand, can use `buildRequest` directly and pass the generated descriptors to `cy.request`. Cypress commands need to stay inside its synchronous command queue, so trying to force both frameworks through the same promise-based client is an easy way to introduce flaky behavior.

## Asserting loading states

Loading states are awkward to test because the API often responds before your assertion gets a chance to run.

`paused` solves that by holding the request open until you're ready to let it continue.

```ts
test('shows a spinner while data loads', async ({ page, glitch }) => {
  await page.goto('/dashboard');

  await glitch.paused(async () => {
    await page.getByRole('button', { name: 'Load' }).click();
    await expect(page.getByTestId('spinner')).toBeVisible();
  });

  await expect(page.getByRole('table')).toBeVisible();
});
```

The scenario resumes as soon as the callback finishes, including when it throws. That means a failed assertion won't leave requests stuck for the rest of the test run.

## Development

```bash
npm ci
npm run build
npm test
```

The integration suite runs against a real Glitch server rather than a stub. That helps catch mismatches between the TypeScript API and the Go config schema.

Install a server binary once, then run the end-to-end tests:

```bash
npm run glitch:install
npx playwright install chromium
npm run test:e2e
```

`glitch:install` builds the server with `go install` and places it in `.glitch/`, so you'll need a Go toolchain installed.

Set `GLITCH_VERSION` if you want to pin a specific version. If you already have a Glitch binary, set `GLITCH_BIN` instead and skip the install step entirely.

| Command             | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm run build`     | Compiles every package to ESM and CommonJS             |
| `npm run typecheck` | Typechecks sources and tests without emitting          |
| `npm test`          | Runs unit tests with `node:test` against a stub server |
| `npm run test:e2e`  | Runs integration tests against a real Glitch server    |
| `npm run clean`     | Removes build output                                   |

## Releasing

Packages version independently. Bump only the ones you changed, then push a `vX.Y.Z` tag to trigger a release.

The manifest version is the source of truth. A package ships only when its version is not already on the registry, so a fix to one adapter goes out without dragging the others along. Preview what a tag would publish:

```bash
node scripts/release-plan.mjs
```

```
publish  glitch-core@0.1.1  (new version)
skip     glitch-playwright@0.1.0  (already on the registry)
```

Publishing happens in dependency order, so nothing ships before something it depends on. The adapters depend on core through a caret range rather than an exact pin, which means a core patch reaches existing users without republishing every adapter.

CI stages rather than publishes. `npm stage publish` uploads a signed, provenanced tarball that nobody can install yet, and a maintainer promotes it:

```bash
npm stage list
npm stage approve <stage-id>
```

That approval needs two-factor authentication, so the credential CI holds cannot ship code on its own. `NPM_TOKEN` should be a granular token with **Read and write (stage only)** permission. The GitHub release is created as a draft for the same reason: publish it once the versions are live.

A tag that would release nothing fails the workflow rather than succeeding quietly.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository layout, testing conventions, and instructions for adding an adapter for another framework.

For security issues, please use [a private advisory](https://github.com/st1lson/glitch-js/security/advisories/new) instead of opening a public issue. See [SECURITY.md](SECURITY.md) for details.

## License

Apache-2.0
