# glitch-core

[![npm](https://img.shields.io/npm/v/glitch-core?logo=npm&color=cb3837)](https://www.npmjs.com/package/glitch-core)
[![downloads](https://img.shields.io/npm/dm/glitch-core?color=blue)](https://www.npmjs.com/package/glitch-core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/glitch-core?label=minzip)](https://bundlephobia.com/package/glitch-core)
[![CI](https://github.com/st1lson/glitch-js/actions/workflows/ci.yml/badge.svg)](https://github.com/st1lson/glitch-js/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/st1lson/glitch-js/blob/main/LICENSE)

Zero-dependency TypeScript client for the [Glitch](https://github.com/st1lson/glitch) chaos-engineering control API.

Most people want a test-framework integration instead:

- [`glitch-playwright`](https://github.com/st1lson/glitch-js/tree/main/packages/playwright) for Playwright

Use this package directly when you are driving Glitch from a script, a custom runner, or a framework that has no integration yet.

```ts
import { GlitchClient } from 'glitch-core';

const glitch = new GlitchClient({ url: 'http://localhost:3000', scenario: 'smoke' });

await glitch.fail(503);
await glitch.latency('2s');

const report = await glitch.scenarioReport();
console.log(report.metrics);

await glitch.reset();
```

## Design

The package is split into two layers, and the split is the point.

`buildRequest` is pure and synchronous. It turns an operation into `{ method, url, headers, body }` and performs no I/O. Integrations that must stay inside a synchronous command queue, such as Cypress calling `cy.request`, can use it without ever touching a promise.

`GlitchClient` wraps that with a pluggable transport, defaulting to the global `fetch`. Replacing the transport is how the Playwright integration routes control traffic through Playwright's own request context so it lands in traces.

```ts
import { GlitchClient, buildRequest } from 'glitch-core';

// Describe the call without making it.
const request = buildRequest({ url: 'http://localhost:3000', scenario: 'smoke' }, { kind: 'reset' });

// Or hand the client your own HTTP stack.
const glitch = new GlitchClient({
  transport: async (call) => {
    const response = await myHttpClient(call);
    return { status: response.status, body: response.text };
  },
});
```

## Input types

Inputs are camelCase and get translated to the snake_case JSON the Go server expects. Durations accept milliseconds or a Go duration string. Bandwidth accepts bytes per second or a suffixed string.

```ts
await glitch.merge({
  latency: { min: 200, max: '1.5s', distribution: 'normal' },
  stall: { rate: 25, mode: 'hang', dropAt: 80 },
  realtime: { dropRate: 10, outOfOrder: true },
});
```

Values are validated before anything is sent, so a malformed duration throws at the call site rather than returning an opaque 400.

## Merge semantics

The server overlays rules additively. `merge` and the shorthands layer onto what a scenario already has, `set` clears the scenario first, and `reset` returns it to the baseline. A rule cannot be switched off by setting its rate to zero.

## Coverage

Every control API endpoint is exposed: health, config, baseline config, rules, profiles, pause, resume, and reports.

Part of [glitch-js](https://github.com/st1lson/glitch-js).

## License

Apache-2.0
