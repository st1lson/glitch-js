/**
 * The path a real suite actually takes: chaos reaching a browser.
 *
 * Everything else in this directory drives Glitch through the `request`
 * fixture, which shares the header plumbing but not the browser. These tests
 * navigate and fetch from a page, which is what the fixtures exist to support.
 */
import { expect, SCENARIO_HEADER, test } from 'glitch-playwright';

declare global {
  interface Window {
    glitchProbe?: { done: boolean; status: number | null };
  }
}

/** Starts a fetch inside the page and records its outcome on window. */
async function startFetch(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.glitchProbe = { done: false, status: null };
    void fetch(target).then((response) => {
      window.glitchProbe = { done: true, status: response.status };
    });
  }, path);
}

test('applies chaos to a top-level navigation', async ({ page, glitch }) => {
  await glitch.fail(503);

  const response = await page.goto('/users');
  expect(response?.status()).toBe(503);
});

test('leaves navigation alone with no chaos configured', async ({ page }) => {
  const response = await page.goto('/users');
  expect(response?.status()).toBe(200);
});

test('applies chaos to a fetch made by page script', async ({ page, glitch }) => {
  await page.goto('/users');
  await glitch.fail(429);

  const status = await page.evaluate(async () => (await fetch('/users')).status);
  expect(status).toBe(429);
});

test('delays a navigation', async ({ page, glitch }) => {
  await glitch.latency('600ms');

  const started = Date.now();
  await page.goto('/users');
  expect(Date.now() - started).toBeGreaterThanOrEqual(550);
});

test('corrupts the payload a page receives', async ({ page, glitch }) => {
  await page.goto('/users');
  await glitch.corruptWith(100, ['break_syntax']);

  const parsed = await page.evaluate(async () => {
    const response = await fetch('/users');
    try {
      await response.json();
      return 'valid';
    } catch {
      return 'invalid';
    }
  });

  expect(parsed).toBe('invalid');
});

test('holds an in-page fetch open for the length of an assertion', async ({ page, glitch }) => {
  await page.goto('/users');

  // This is the loading-spinner pattern the README documents, with the fetch
  // standing in for whatever the app does while its spinner is up.
  await glitch.paused(async () => {
    await startFetch(page, '/users');

    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.glitchProbe?.done)).toBe(false);
  });

  await expect.poll(async () => page.evaluate(() => window.glitchProbe?.done)).toBe(true);
  expect(await page.evaluate(() => window.glitchProbe?.status)).toBe(200);
});

test('confines browser chaos to this test scenario', async ({ page, request, glitch }) => {
  await glitch.fail(503);

  expect((await page.goto('/users'))?.status()).toBe(503);

  // A request tagged with a different scenario is unaffected, which is what
  // makes parallel browser tests safe against one shared Glitch server.
  const other = await request.get('/users', { headers: { [SCENARIO_HEADER]: 'other-browser-scenario' } });
  expect(other.status()).toBe(200);
});

test.describe('with per-test extra headers', () => {
  test.use({ extraHTTPHeaders: { 'X-Tenant': 'acme' } });

  test('keeps the scenario header alongside them', async ({ page, glitch }) => {
    // A test.use block sets the option directly, bypassing the fixture that
    // merges the scenario header in. The context fixture re-applies it, so
    // browser traffic still reaches the right scenario.
    await glitch.routes([
      { path: '/users', headers: { 'X-Tenant': 'acme' }, failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    expect((await page.goto('/users'))?.status()).toBe(503);
  });
});

test.describe('header injection disabled', () => {
  test.use({ glitchInjectHeader: false });

  test('leaves browser traffic untagged', async ({ page, glitch }) => {
    await glitch.fail(503);

    // Nothing tags the navigation, so the scenario rules do not reach it.
    expect((await page.goto('/users'))?.status()).toBe(200);
  });
});
