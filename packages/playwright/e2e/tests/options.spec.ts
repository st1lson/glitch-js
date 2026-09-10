/**
 * The fixture options, and the isolation guarantees they underpin.
 *
 * Each block uses `test.use`, which is the same route a project in
 * playwright.config.ts takes. The options are deliberately separate rather than
 * one grouped object, so overriding one here does not discard the rest.
 */
import { expect, SCENARIO_HEADER, test } from 'glitch-playwright';

test.describe('scenario derivation', () => {
  test('derives an id from the test itself', async ({ glitchScenario }) => {
    expect(glitchScenario).toContain('options-spec-ts');
    expect(glitchScenario).toContain('derives-an-id-from-the-test-itself');
  });

  test('produces a header-safe id', async ({ glitchScenario }) => {
    expect(glitchScenario).toMatch(/^[a-z0-9-]+$/);
    expect(glitchScenario.length).toBeLessThanOrEqual(120);
  });

  test('gives sibling tests different ids', async ({ glitchScenario }) => {
    expect(glitchScenario).not.toContain('derives-an-id-from-the-test-itself');
  });
});

// Serial because these tests share one pinned scenario. Run in parallel, one
// test's teardown would reset the rules another is still asserting against.
test.describe
  .serial('a fixed scenario id', () => {
    test.use({ glitchScenarioName: 'pinned-scenario-id' });

    test('keeps the URL its project configured', async ({ glitch }) => {
      // Overriding one option must not discard the others. A grouped option would
      // have dropped the project URL here and fallen back to port 3000.
      expect(glitch.url).toContain('3100');
    });

    test('uses the id it was given', async ({ glitchScenario, glitch }) => {
      expect(glitchScenario).toBe('pinned-scenario-id');
      expect(glitch.scenario).toBe('pinned-scenario-id');
    });

    test('tags traffic with the pinned id', async ({ request, glitch }) => {
      await glitch.fail(503);

      const response = await request.get('/users');
      expect(response.headers()['x-glitch-scenario']).toBe('pinned-scenario-id');
      expect(response.status()).toBe(503);
    });
  });

// Computing an id per test goes through glitchFixtures rather than an option,
// and is covered in extend.spec.ts.

test.describe('header injection disabled', () => {
  test.use({ glitchInjectHeader: false });

  test('sends no scenario header', async ({ request }) => {
    const response = await request.get('/users');
    expect(response.headers()['x-glitch-scenario']).toBeUndefined();
  });

  test('leaves the scenario rules unapplied to untagged traffic', async ({ request, glitch }) => {
    await glitch.fail(503);

    // The rules exist, but nothing tags the request with the scenario, so the
    // server never applies them.
    expect((await glitch.config()).failure.statuses).not.toBeNull();
    expect((await request.get('/users')).status()).toBe(200);
  });

  test('still lets the header be set by hand', async ({ request, glitch, glitchScenario }) => {
    await glitch.fail(503);

    const response = await request.get('/users', { headers: { [SCENARIO_HEADER]: glitchScenario } });
    expect(response.status()).toBe(503);
  });
});

test.describe('per-test extra headers', () => {
  test.use({ extraHTTPHeaders: { 'X-Tenant': 'acme' } });

  test('sends the configured header', async ({ request, glitch }) => {
    await glitch.routes([
      { path: '/users', headers: { 'X-Tenant': 'acme' }, failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    // The request fixture reaches the server, tagged or not.
    expect((await request.get('/users')).status()).toBe(200);
  });

  test('drops the scenario header from the request fixture', async ({ request }) => {
    // A test.use block sets the option directly, bypassing the fixture that
    // merges the scenario header in. The context fixture covers browser
    // traffic; the request fixture needs the header passed by hand.
    expect((await request.get('/users')).headers()['x-glitch-scenario']).toBeUndefined();
  });

  test('still works when the header is passed explicitly', async ({ request, glitch, glitchScenario }) => {
    await glitch.fail(503);

    const response = await request.get('/users', { headers: { [SCENARIO_HEADER]: glitchScenario } });
    expect(response.status()).toBe(503);
  });
});

test.describe
  .serial('reset disabled', () => {
    test.use({ glitchScenarioName: 'no-reset-scenario', glitchReset: false });

    test('leaves rules behind for the next test', async ({ glitch }) => {
      await glitch.fail(503);
      expect((await glitch.config()).failure.statuses).not.toBeNull();
    });

    test('finds the previous rules still in place', async ({ request, glitch }) => {
      expect((await request.get('/users')).status()).toBe(503);
      await glitch.reset();
    });
  });

test.describe('the fetch transport', () => {
  test.use({ glitchTransport: 'fetch' });

  test('drives chaos without Playwright request context', async ({ request, glitch }) => {
    await glitch.fail(503);
    expect((await request.get('/users')).status()).toBe(503);
  });

  test('still reports config correctly', async ({ glitch }) => {
    await glitch.latency('120ms');
    expect((await glitch.config()).latency.fixed).toBe('120ms');
  });
});

test.describe
  .serial('teardown', () => {
    test.use({ glitchScenarioName: 'teardown-scenario' });

    test('leaves a paused scenario running for the next test', async ({ glitch }) => {
      // A pause that outlived its test would block everything else tagged with
      // this scenario. The fixture resumes unconditionally during teardown.
      await glitch.pause({ timeout: '30s' });
      expect((await glitch.health()).paused).toBe(true);
    });

    test('finds the scenario resumed', async ({ request, glitch }) => {
      expect((await glitch.health()).paused).toBe(false);

      const started = Date.now();
      expect((await request.get('/users')).status()).toBe(200);
      expect(Date.now() - started).toBeLessThan(2000);
    });
  });
