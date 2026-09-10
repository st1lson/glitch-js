# Contributing

## Getting set up

```bash
npm ci
npm run build
npm test
```

Node 22.18 or newer, because the unit tests run TypeScript sources directly and native type stripping is unflagged from that version. The published packages themselves only need Node 20.11, which CI verifies by importing the built tarballs on it.

The build is TypeScript and nothing else, so there is no bundler to configure.

The integration suite drives a real Glitch server rather than a stub. That is what keeps the hand-written TypeScript types honest against the Go config schema, so it needs a server binary and a browser:

```bash
npm run glitch:install
npx playwright install chromium
npm run test:e2e
```

`glitch:install` builds the server with `go install` into `.glitch/`, so it needs a Go toolchain. Set `GLITCH_VERSION` to pin a version, or `GLITCH_BIN` to point at a binary you already have and skip the install.

## Tooling

[Biome](https://biomejs.dev) handles both linting and formatting, in place of ESLint and Prettier. That is not only a size decision: `typescript-eslint` supports TypeScript up to 6.1, and this repo builds on TypeScript 7, so the ESLint route would mean pinning the compiler back. Biome has its own parser and no peer dependency on the compiler at all.

| Command | What it does |
| --- | --- |
| `npm run lint` | Lint and format check, no writes |
| `npm run lint:fix` | Applies every safe fix, including import sorting |
| `npm run format` | Formats only |
| `npm run check` | Lint, typecheck and unit tests together |

A pre-commit hook runs Biome over staged files through lint-staged, so formatting never lands in review. A pre-push hook runs the typecheck and the unit tests. Both are ordinary git hooks: `--no-verify` skips them when you need it.

Hooks install themselves on `npm ci` through the `prepare` script. If they ever stop firing, `npm run prepare` re-registers them.

The one trade-off worth knowing: Biome cannot do type-aware linting, so rules like `no-floating-promises` are not available. The compiler covers part of that gap with `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns` turned on in `tsconfig.base.json`.

## Layout

| Path | What lives there |
| --- | --- |
| `packages/core` | Framework-agnostic client, zero dependencies |
| `packages/playwright` | Playwright fixtures |
| `packages/playwright/e2e` | Integration suite against a real server |
| `scripts` | Build and release helpers |

Core has two layers, and the split matters. `buildRequest` is pure and synchronous, turning an operation into a plain request descriptor with no I/O. `GlitchClient` wraps that with a swappable transport. Keep it that way: a future Cypress adapter needs the synchronous half, because Cypress commands cannot await promises without going flaky.

## Adding a framework adapter

An adapter belongs in `packages/<framework>` and should:

- depend on `glitch-core` and declare the framework as a peer dependency, never a direct one
- derive a scenario id per test that is stable across retries and distinct across parallel workers
- tag the framework's outgoing requests with the `X-Glitch-Scenario` header
- resume and reset in teardown unconditionally, so a failed test cannot leave a scenario paused for the rest of the run

Copy the tsconfig trio and the `build` script from an existing package. The dual ESM and CommonJS output is two `tsc` runs plus `scripts/fixup.mjs`, with no bundler involved.

## Tests

Unit tests run on `node:test` against a stub server, with no dependencies. Put anything that needs real server behaviour in the integration suite instead, where it will catch schema drift.

A few conventions the suite already follows, worth keeping:

- Pin chaos rates to 100 when an assertion depends on the outcome. The one statistical test uses a sample large enough that its bounds are many standard deviations wide.
- Compare timings against another request rather than an absolute ceiling, so contention between parallel workers cannot fail a test.
- Mark a describe block `serial` if its tests share a pinned scenario. In parallel, one test's teardown resets rules another is still asserting against.

## Comments

Write a comment only when it explains something the next line does not: a server behaviour that surprised you, an ordering constraint, a workaround. Delete anything that restates the code.

## Releasing

Packages version independently. Bump only what you changed, then push a `vX.Y.Z` tag.

`scripts/release-plan.mjs` decides what ships: a package is published only when its manifest version is not already on the registry, in dependency order. Run it locally to preview a release. A tag that would publish nothing fails rather than succeeding quietly.

Bump core alone when the fix is in core. Existing adapter releases pick it up through their caret range, so they do not need republishing unless their own code changed. Bump an adapter alone when the fix is only there.

CI stages the tarballs rather than publishing them, so a leaked `NPM_TOKEN` cannot make a version installable. Promote a staged release with `npm stage approve`, which requires two-factor authentication, then publish the draft GitHub release the workflow created.

A brand-new package cannot be staged, so its first version is published by hand with `npm publish` and is the only one without provenance. Staging works from the second version onward.

Run the workflow manually with the dry-run input to see it build, test and pack without staging anything.

Once there are more adapters or outside contributors, [Changesets](https://github.com/changesets/changesets) is the natural upgrade: contributors declare the bump alongside their change, and a bot opens the version PR.
