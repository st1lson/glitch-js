/**
 * The "extend your own test type" path, which is what anyone with existing
 * fixtures uses instead of importing the ready-made `test`.
 *
 * It is also the only way to compute a scenario id per test, since Playwright
 * treats a function-valued option as a fixture function.
 */

import { test as base, expect } from '@playwright/test';
import { type GlitchFixtures, type GlitchOptions, glitchFixtures } from 'glitch-playwright';

interface AppFixtures {
  /** Stands in for whatever fixtures a real project already has. */
  appName: string;
}

const test = base.extend<AppFixtures & GlitchOptions & GlitchFixtures>({
  appName: async ({}, use) => {
    await use('checkout');
  },

  ...glitchFixtures({
    scenario: (testInfo) => `extended-${testInfo.title.split(' ')[0]}-${testInfo.parallelIndex}`,
  }),
});

test('keeps the fixtures the project already had', async ({ appName, glitch }) => {
  expect(appName).toBe('checkout');
  expect((await glitch.health()).status).toBe('ok');
});

test('computes the scenario id with the function it was given', async ({ glitchScenario }) => {
  expect(glitchScenario).toMatch(/^extended-computes-\d+$/);
});

test('tags traffic with the computed id', async ({ request, glitch, glitchScenario }) => {
  await glitch.fail(503);

  const response = await request.get('/users');
  expect(response.headers()['x-glitch-scenario']).toBe(glitchScenario);
  expect(response.status()).toBe(503);
});

test.describe('with a pinned id', () => {
  test.use({ glitchScenarioName: 'extended-pinned' });

  test('lets the option win over the factory function', async ({ glitchScenario }) => {
    expect(glitchScenario).toBe('extended-pinned');
  });
});

test('injects chaos through the extended type', async ({ request, glitch }) => {
  await glitch.latency('400ms');

  const started = Date.now();
  await request.get('/users');
  expect(Date.now() - started).toBeGreaterThanOrEqual(350);
});
