# glitch-playwright

[![npm](https://img.shields.io/npm/v/glitch-playwright?logo=npm&color=cb3837)](https://www.npmjs.com/package/glitch-playwright)
[![downloads](https://img.shields.io/npm/dm/glitch-playwright?color=blue)](https://www.npmjs.com/package/glitch-playwright)
[![bundle size](https://img.shields.io/bundlephobia/minzip/glitch-playwright?label=minzip)](https://bundlephobia.com/package/glitch-playwright)
[![CI](https://github.com/st1lson/glitch-js/actions/workflows/ci.yml/badge.svg)](https://github.com/st1lson/glitch-js/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/st1lson/glitch-js/blob/main/LICENSE)

Playwright fixtures for [Glitch](https://github.com/st1lson/glitch), the API chaos-engineering interceptor.

Break the backend on purpose, from inside a test, and assert what your app does about it. Every test gets its own isolated chaos scenario, so the suite still runs in parallel.

```ts
import { expect, test } from 'glitch-playwright';

test('shows an error toast when the API fails', async ({ page, glitch }) => {
  await glitch.fail(500);

  await page.goto('/dashboard');
  await expect(page.getByRole('alert')).toHaveText('Something went wrong');
});
```

## Install

```bash
npm install --save-dev glitch-playwright
```

Playwright is a peer dependency. Node 20.11 or newer.

## Setup

Import `test` and `expect` from this package instead of from `@playwright/test`:

```ts
import { expect, test } from 'glitch-playwright';
```

If you already have your own test type, extend it instead:

```ts
// fixtures.ts
import { test as base } from '@playwright/test';
import { glitchFixtures } from 'glitch-playwright';

export const test = base.extend(glitchFixtures());
export { expect } from '@playwright/test';
```

Then point the fixtures at your Glitch server. The default is `http://localhost:3000`.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { GlitchOptions } from 'glitch-playwright';

export default defineConfig<GlitchOptions>({
  use: {
    baseURL: 'http://localhost:3000',
    glitchUrl: 'http://localhost:3000',
  },
});
```

`GLITCH_URL` and `GLITCH_TOKEN` work as environment fallbacks, which is usually what you want in CI.

That is the whole setup. No `beforeEach`, no cleanup hooks, no manual headers.

## Asserting loading states

Loading spinners are the flakiest thing in most suites, because the API answers before the assertion runs. `paused` holds the request open for exactly as long as you need.

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

The scenario resumes when the callback returns, and also if it throws. A failed assertion cannot leave requests wedged for the rest of the run.

## What you can break

```ts
await glitch.fail(503);                       // every request returns 503
await glitch.fail(429, 30);                   // 30% of requests return 429
await glitch.failRate(20);                    // 20% return 500
await glitch.latency('2s');                   // flat 2 second delay
await glitch.latency({ min: 200, max: 1500, distribution: 'normal' });
await glitch.throttle('50kbps');              // slow download, streamed in chunks
await glitch.corrupt(100);                    // mutate JSON response bodies
await glitch.stall({ rate: 100, mode: 'drop', dropAt: 50 });
await glitch.profile('3g');                   // mobile, 3g, bad-wifi, production
await glitch.realtime({ dropRate: 25, outOfOrder: true });
```

Durations take milliseconds or a Go duration string, so `2000` and `'2s'` are the same thing. Bandwidth takes bytes per second or a suffixed string.

Route overrides break one endpoint and leave the rest healthy:

```ts
await glitch.routes([
  { path: '/api/checkout', method: 'POST', failure: { rate: 100 } },
  { path: '/api/products/*', latency: { fixed: 0 } },
]);
```

For anything the shorthands do not cover, `merge` takes the full chaos config.

## Merge, set and reset

Glitch overlays rules additively, and this package does not hide that.

- `merge(config)` and every shorthand layer onto what the scenario already has.
- `set(config)` clears the scenario first, then applies.
- `reset()` returns the scenario to the server's baseline config.

A rule cannot be switched off by setting its rate to zero. That is a server property, not an SDK one. Reset the scenario instead, which the fixtures already do after every test.

## Scenario isolation

Each test gets a scenario id derived from its file, project, title and worker index, and the fixtures put that id on the `X-Glitch-Scenario` header of every request the browser makes. Glitch applies a test's rules only to traffic carrying its id, so parallel workers do not fight over one server.

Retries reuse the same id, so a retried test runs against the rules it was written for.

The header is set on the browser context, which covers popups, web workers and service workers. It is also sent to third-party origins the page talks to. If that is a problem, set `injectHeader: false` and apply the header yourself.

Read the current id from the `glitchScenario` fixture, and pin it when tests should deliberately share rules:

```ts
test.use({ glitchScenarioName: 'shared-checkout-scenario' });
```

To compute an id per test, pass a function to `glitchFixtures` instead. Playwright treats a function-valued option as a fixture function, so this cannot go through `test.use`:

```ts
export const test = base.extend(
  glitchFixtures({ scenario: (testInfo) => `tenant-${testInfo.project.name}` }),
);
```

## Failure reports

When a test fails, the fixtures attach that scenario's Glitch report to the Playwright report as `glitch-report.json`. It lists every request Glitch saw, along with the latency it added, the failures it injected and the payloads it corrupted, so you can tell a real bug from injected chaos without rerunning anything.

## Options

Each of these is a separate Playwright option, settable in `playwright.config.ts`, in a project, or in a `test.use` block. They are separate rather than grouped into one object on purpose: Playwright replaces an option wholesale when `test.use` sets it, so a single object would mean a describe block that pins a scenario silently discards the URL its project configured.

| Option | Default | What it does |
| --- | --- | --- |
| `glitchUrl` | `GLITCH_URL`, then `http://localhost:3000` | Base URL of the Glitch server |
| `glitchToken` | `GLITCH_TOKEN` | Bearer token for the control API |
| `glitchScenarioName` | derived from the test | Pins the scenario id |
| `glitchInjectHeader` | `true` | Add the scenario header to browser traffic |
| `glitchReset` | `true` | Clear the scenario's rules after each test |
| `glitchAttachReport` | `true` | Attach the Glitch report to failed tests |
| `glitchPauseTimeout` | `'30s'` | Failsafe auto-resume for `pause` |
| `glitchTransport` | `'playwright'` | Send control calls through Playwright, or `'fetch'` |

The same values can be given as defaults to `glitchFixtures({ url, token, scenario, ... })`, which is also the only place `scenario` accepts a function.

Control calls go through Playwright's request context by default, so they appear in traces and honour the project's proxy and TLS settings. Switch to `'fetch'` if a configured proxy cannot reach Glitch.

One caveat on headers. Setting `extraHTTPHeaders` in a `test.use` block replaces the option outright and bypasses the fixture that merges the scenario header in. Browser traffic is still tagged, because the context fixture re-applies it, but calls made through the `request` fixture in such a block are not. Pass the header explicitly there, or set `extraHTTPHeaders` at the config or project level instead.

## Authentication

Glitch allows control API calls from loopback without a token. Off loopback, start it with `--control-token` and pass the same value as `token` or `GLITCH_TOKEN`.

Part of [glitch-js](https://github.com/st1lson/glitch-js).

## License

Apache-2.0
