import type {
  Fixtures,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestInfo,
} from '@playwright/test';
import {
  DEFAULT_PAUSE_TIMEOUT,
  type DurationInput,
  GlitchClient,
  type GlitchClientOptions,
  GlitchResponseError,
  HTTP_STATUS,
  MEDIA_TYPE_JSON,
  SCENARIO_HEADER,
  type ScenarioReport,
} from 'glitch-core';

import { FIXTURE_DEFAULTS, REPORT_ATTACHMENT, TEARDOWN_ANNOTATION } from './constants.ts';
import { scenarioFromTestInfo } from './scenario.ts';
import { apiRequestTransport } from './transport.ts';

export type ScenarioSource = string | ((testInfo: TestInfo) => string);

export type GlitchTransportKind = 'playwright' | 'fetch';

/**
 * Separate options rather than one object, because Playwright replaces an
 * option wholesale when `test.use` sets it. Grouped, a describe block pinning a
 * scenario would silently discard the URL its project configured.
 */
export interface GlitchOptions {
  /** Falls back to `GLITCH_URL`, then `http://localhost:3000`. */
  glitchUrl: string | undefined;

  /** Falls back to `GLITCH_TOKEN`. */
  glitchToken: string | undefined;

  /**
   * Pins the id instead of deriving one per test. Set it only when tests must
   * deliberately share rules.
   *
   * A string rather than a function, because Playwright treats a
   * function-valued option as a fixture function. To compute an id per test,
   * pass `scenario` to {@link glitchFixtures} instead.
   */
  glitchScenarioName: string | undefined;

  /**
   * Tags browser traffic, popups, web workers and service workers included.
   * That reach has a cost: third-party origins the page talks to see the header
   * too. Defaults to true.
   */
  glitchInjectHeader: boolean;

  /** Clears the scenario's rules after each test. Defaults to true. */
  glitchReset: boolean;

  /**
   * Attaches the scenario report to failed tests, showing which requests were
   * delayed, failed or corrupted. Defaults to true.
   */
  glitchAttachReport: boolean;

  /** Failsafe timeout for pause. Defaults to 30 seconds. */
  glitchPauseTimeout: DurationInput;

  /** Switch to `fetch` if a configured proxy cannot reach Glitch. */
  glitchTransport: GlitchTransportKind;
}

export interface GlitchFixtures {
  /** The resolved id this test's rules and traffic are tagged with. */
  glitchScenario: string;
  glitch: GlitchClient;
}

export interface GlitchFixtureOptions {
  url?: string;
  token?: string;
  scenario?: ScenarioSource;
  injectHeader?: boolean;
  reset?: boolean;
  attachReport?: boolean;
  pauseTimeout?: DurationInput;
  transport?: GlitchTransportKind;
}

type ParentArgs = PlaywrightTestArgs & PlaywrightTestOptions;
type ParentWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

/**
 * Builds the fixture object to hand to `test.extend`. Values passed here are
 * the lowest-priority defaults: a config's `use` block overrides them, and a
 * `test.use` block overrides that.
 *
 * @example
 * ```ts
 * export const test = base.extend(glitchFixtures());
 * ```
 */
export function glitchFixtures(
  defaults: GlitchFixtureOptions = {},
): Fixtures<GlitchOptions & GlitchFixtures, object, ParentArgs, ParentWorkerArgs> {
  return {
    glitchUrl: [defaults.url, { option: true }],
    glitchToken: [defaults.token, { option: true }],
    glitchScenarioName: [
      typeof defaults.scenario === 'string' ? defaults.scenario : undefined,
      { option: true },
    ],
    glitchInjectHeader: [defaults.injectHeader ?? FIXTURE_DEFAULTS.injectHeader, { option: true }],
    glitchReset: [defaults.reset ?? FIXTURE_DEFAULTS.reset, { option: true }],
    glitchAttachReport: [defaults.attachReport ?? FIXTURE_DEFAULTS.attachReport, { option: true }],
    glitchPauseTimeout: [defaults.pauseTimeout ?? DEFAULT_PAUSE_TIMEOUT, { option: true }],
    glitchTransport: [defaults.transport ?? FIXTURE_DEFAULTS.transport, { option: true }],

    glitchScenario: async ({ glitchScenarioName }, use, testInfo) => {
      const derived =
        typeof defaults.scenario === 'function'
          ? defaults.scenario(testInfo)
          : scenarioFromTestInfo(testInfo);

      await use(glitchScenarioName ?? derived);
    },

    // Overriding the option keeps the project's own headers and covers the
    // request fixture too, which setting them on the context would not.
    extraHTTPHeaders: async ({ extraHTTPHeaders, glitchInjectHeader, glitchScenario }, use) => {
      if (!glitchInjectHeader) {
        await use(extraHTTPHeaders);
        return;
      }

      await use({ ...extraHTTPHeaders, [SCENARIO_HEADER]: glitchScenario });
    },

    // A test.use({ extraHTTPHeaders }) block sets the option directly and
    // bypasses the override above, stripping the scenario header. Re-applying
    // it here keeps browser traffic tagged.
    context: async ({ context, extraHTTPHeaders, glitchInjectHeader, glitchScenario }, use) => {
      if (glitchInjectHeader) {
        await context.setExtraHTTPHeaders({ ...extraHTTPHeaders, [SCENARIO_HEADER]: glitchScenario });
      }

      await use(context);
    },

    glitch: async (
      {
        request,
        glitchUrl,
        glitchToken,
        glitchScenario,
        glitchPauseTimeout,
        glitchTransport,
        glitchReset,
        glitchAttachReport,
      },
      use,
      testInfo,
    ) => {
      const clientOptions: GlitchClientOptions = {
        url: glitchUrl,
        token: glitchToken,
        scenario: glitchScenario,
        pauseTimeout: glitchPauseTimeout,
      };

      if (glitchTransport !== 'fetch') {
        clientOptions.transport = apiRequestTransport(request);
      }

      const client = new GlitchClient(clientOptions);
      await use(client);
      await teardown(client, { reset: glitchReset, attachReport: glitchAttachReport }, testInfo);
    },
  };
}

/**
 * Resume runs first and unconditionally, so a test that failed mid-pause cannot
 * block the rest of the run. Problems become annotations rather than throws, so
 * an absent server cannot turn a passing test red or mask a real failure.
 */
async function teardown(
  client: GlitchClient,
  options: { reset: boolean; attachReport: boolean },
  testInfo: TestInfo,
): Promise<void> {
  await attempt(testInfo, 'resume', () => client.resume());

  if (options.attachReport && testInfo.status !== testInfo.expectedStatus) {
    await attempt(testInfo, 'attach report', async () => {
      let report: ScenarioReport;
      try {
        report = await client.scenarioReport();
      } catch (error) {
        // Glitch only tracks a scenario once rules have been applied to it.
        if (error instanceof GlitchResponseError && error.status === HTTP_STATUS.notFound) return;
        throw error;
      }

      await testInfo.attach(REPORT_ATTACHMENT, {
        body: JSON.stringify(report, null, 2),
        contentType: MEDIA_TYPE_JSON,
      });
    });
  }

  if (options.reset) {
    await attempt(testInfo, 'reset', () => client.reset());
  }
}

async function attempt(testInfo: TestInfo, step: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    testInfo.annotations.push({
      type: TEARDOWN_ANNOTATION,
      description: `Could not ${step}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
