/**
 * Integration coverage for the Playwright fixtures, run against a real Glitch
 * server. These tests use the `request` fixture rather than `page`, so they
 * need no browser download while still exercising the same header injection
 * path a browser would take.
 */
import { expect, SCENARIO_HEADER, test } from 'glitch-playwright';

test('tags outgoing requests with this test scenario', async ({ request, glitchScenario }) => {
  const response = await request.get('/users');

  // Glitch echoes the scenario back on the response, which proves the header
  // reached the server rather than merely being configured on the client.
  expect(response.headers()['x-glitch-scenario']).toBe(glitchScenario);
  expect(glitchScenario).toContain('tags-outgoing-requests');
});

test('starts from a clean baseline', async ({ request, glitch }) => {
  const config = await glitch.config();

  expect(config.failure.rate).toBe(0);
  expect((await request.get('/users')).status()).toBe(200);
});

test('injects a deterministic status code', async ({ request, glitch }) => {
  await glitch.fail(503);

  const response = await request.get('/users');
  expect(response.status()).toBe(503);
});

test('confines rules to the scenario that set them', async ({ request, glitch }) => {
  await glitch.fail(503);

  // Same server, different scenario: the rule must not apply.
  const other = await request.get('/users', { headers: { [SCENARIO_HEADER]: 'unrelated-scenario' } });
  expect(other.status()).toBe(200);

  expect((await request.get('/users')).status()).toBe(503);
});

test('adds latency', async ({ request, glitch }) => {
  await glitch.latency('600ms');

  const started = Date.now();
  await request.get('/users');
  expect(Date.now() - started).toBeGreaterThanOrEqual(550);
});

test('holds requests while paused, then releases them', async ({ request, glitch }) => {
  const pending = Symbol('pending');
  let inFlight!: ReturnType<typeof request.get>;

  await glitch.paused(async () => {
    inFlight = request.get('/users');

    await expect.poll(async () => (await glitch.health()).paused).toBe(true);
    await expect(Promise.race([inFlight, Promise.resolve(pending)])).resolves.toBe(pending);
  });

  expect((await inFlight).status()).toBe(200);
});

test('applies a named profile', async ({ glitch }) => {
  await glitch.profile('3g');

  const config = await glitch.config();
  expect(config.latency.min === '0s' && config.latency.fixed === '0s').toBe(false);
});

test('merges rules instead of replacing them', async ({ glitch }) => {
  await glitch.latency('200ms');
  await glitch.failRate(25);

  const config = await glitch.config();
  expect(config.latency.fixed).toBe('200ms');
  expect(config.failure.rate).toBe(25);
});

test('replaces rules when set is used', async ({ glitch }) => {
  await glitch.latency('200ms');
  await glitch.set({ failure: { rate: 25 } });

  const config = await glitch.config();
  expect(config.latency.fixed).toBe('0s');
  expect(config.failure.rate).toBe(25);
});

test('reports the rules a previous test left behind as gone', async ({ request }) => {
  // Every preceding test set failure rules under its own scenario. This one has
  // a fresh scenario and must see a healthy server.
  expect((await request.get('/users')).status()).toBe(200);
});
