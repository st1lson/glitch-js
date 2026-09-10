/**
 * Playwright fixtures for Glitch.
 *
 * Import `test` and `expect` from here instead of from `@playwright/test`, or
 * call {@link glitchFixtures} to extend a test type you already have.
 *
 * @example
 * ```ts
 * import { expect, test } from 'glitch-playwright';
 *
 * test('shows an error toast when the API fails', async ({ page, glitch }) => {
 *   await glitch.fail(500);
 *   await page.goto('/dashboard');
 *   await expect(page.getByRole('alert')).toBeVisible();
 * });
 * ```
 */
import { test as base } from '@playwright/test';

import { type GlitchFixtures, type GlitchOptions, glitchFixtures } from './fixtures.ts';

export { expect } from '@playwright/test';
export type {
  BandwidthInput,
  ChaosInput,
  CorruptionInput,
  CorruptionStrategy,
  DurationInput,
  FailureInput,
  GlitchConfig,
  LatencyInput,
  ProfileName,
  RealtimeInput,
  RouteInput,
  ScenarioReport,
  StallInput,
} from 'glitch-core';
export {
  GlitchClient,
  GlitchConnectionError,
  GlitchError,
  GlitchInputError,
  GlitchResponseError,
  SCENARIO_HEADER,
} from 'glitch-core';
export { FIXTURE_DEFAULTS, REPORT_ATTACHMENT, TEARDOWN_ANNOTATION } from './constants.ts';
export type {
  GlitchFixtureOptions,
  GlitchFixtures,
  GlitchOptions,
  GlitchTransportKind,
  ScenarioSource,
} from './fixtures.ts';
export { glitchFixtures } from './fixtures.ts';
export { scenarioFromTestInfo } from './scenario.ts';
export { apiRequestTransport } from './transport.ts';

export const test = base.extend<GlitchOptions & GlitchFixtures>(glitchFixtures());
