/**
 * Control operations: pausing, profiles, resetting, reporting, and the errors
 * the client raises when any of them is misused.
 */
import { expect, GlitchInputError, GlitchResponseError, SCENARIO_HEADER, test } from 'glitch-playwright';

test.describe('pause and resume', () => {
  test('reports the paused state on health', async ({ glitch }) => {
    expect((await glitch.health()).paused).toBe(false);

    await glitch.pause({ timeout: '10s' });
    expect((await glitch.health()).paused).toBe(true);

    await glitch.resume();
    expect((await glitch.health()).paused).toBe(false);
  });

  test('holds a request until resumed', async ({ request, glitch }) => {
    await glitch.pause({ timeout: '10s' });

    let settled = false;
    const inFlight = request.get('/users').then((response) => {
      settled = true;
      return response;
    });

    await expect.poll(async () => (await glitch.health()).paused).toBe(true);
    expect(settled).toBe(false);

    await glitch.resume();
    expect((await inFlight).status()).toBe(200);
  });

  test('auto-resumes when the timeout expires', async ({ request, glitch }) => {
    await glitch.pause({ timeout: '1s' });

    const started = Date.now();
    const response = await request.get('/users');
    const elapsed = Date.now() - started;

    expect(response.status()).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(700);
    expect((await glitch.health()).paused).toBe(false);
  });

  test('leaves the control API reachable while paused', async ({ glitch }) => {
    await glitch.pause({ timeout: '10s' });

    // The control routes are mounted ahead of the pause middleware, which is
    // the only reason a resume can ever get through.
    expect((await glitch.config()).port).toBeGreaterThan(0);

    await glitch.resume();
  });

  test('resumes after the callback throws', async ({ glitch }) => {
    await expect(
      glitch.paused(async () => {
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');

    expect((await glitch.health()).paused).toBe(false);
  });

  test('returns the callback result', async ({ glitch }) => {
    expect(await glitch.paused(async () => 42)).toBe(42);
  });

  test('tolerates a resume with nothing paused', async ({ glitch }) => {
    await glitch.resume();
    expect((await glitch.health()).paused).toBe(false);
  });

  test('confines a pause to its own scenario', async ({ request, glitch }) => {
    await glitch.pause({ timeout: '5s' });

    // A different scenario is unaffected, which is what lets the suite pause
    // one test while the rest keep running.
    const response = await request.get('/users', {
      headers: { [SCENARIO_HEADER]: 'unpaused-scenario' },
    });
    expect(response.status()).toBe(200);

    await glitch.resume();
  });
});

test.describe('profiles', () => {
  test('lists the built-in profiles', async ({ glitch }) => {
    const profiles = await glitch.profiles();
    expect(profiles.builtin).toEqual(['mobile', '3g', 'bad-wifi', 'production']);
  });

  test('applies each built-in profile', async ({ glitch }) => {
    const expected = {
      mobile: { min: '300ms', max: '2s', rate: 5 },
      '3g': { min: '1s', max: '5s', rate: 10 },
      'bad-wifi': { min: '200ms', max: '4s', rate: 15 },
      production: { min: '50ms', max: '200ms', rate: 1 },
    };

    for (const [name, values] of Object.entries(expected)) {
      await glitch.profile(name);

      const config = await glitch.config();
      expect(config.latency.min, name).toBe(values.min);
      expect(config.latency.max, name).toBe(values.max);
      expect(config.failure.rate, name).toBe(values.rate);
    }
  });

  test('clears earlier rules instead of layering on them', async ({ glitch }) => {
    await glitch.latency('9s');
    await glitch.profile('production');

    // The server resets the scenario before applying a profile, so the 9s
    // fixed delay is gone rather than merged.
    const config = await glitch.config();
    expect(config.latency.fixed).toBe('0s');
    expect(config.latency.max).toBe('200ms');
  });

  test('reports an unknown profile as a 404', async ({ glitch }) => {
    await expect(glitch.profile('does-not-exist')).rejects.toThrow(GlitchResponseError);

    await glitch.profile('does-not-exist').catch((error: unknown) => {
      expect(error).toBeInstanceOf(GlitchResponseError);
      expect((error as GlitchResponseError).status).toBe(404);
      expect((error as GlitchResponseError).message).toContain('profile');
    });
  });
});

test.describe('config and reset', () => {
  test('leaves the baseline untouched when a scenario is overlaid', async ({ glitch }) => {
    await glitch.failRate(100);

    expect((await glitch.config()).failure.rate).toBe(100);
    expect((await glitch.baseline()).failure.rate).toBe(0);
  });

  test('returns the scenario to the baseline on reset', async ({ request, glitch }) => {
    await glitch.fail(503);
    expect((await request.get('/users')).status()).toBe(503);

    await glitch.reset();

    expect((await glitch.config()).failure.statuses).toBeNull();
    expect((await request.get('/users')).status()).toBe(200);
  });

  test('cannot switch a rule off by setting its rate to zero', async ({ request, glitch }) => {
    await glitch.failRate(100);
    await glitch.failRate(0);

    // The server merge is additive and ignores zero values, so this is still
    // failing. Reset is the only way back.
    expect((await request.get('/users')).status()).toBe(500);

    await glitch.reset();
    expect((await request.get('/users')).status()).toBe(200);
  });

  test('accepts an empty merge as a no-op', async ({ glitch }) => {
    const before = await glitch.config();
    const after = await glitch.merge({});
    expect(after.failure.rate).toBe(before.failure.rate);
  });

  test('returns the resulting config from a merge', async ({ glitch }) => {
    const config = await glitch.merge({ latency: { fixed: '750ms' } });
    expect(config.latency.fixed).toBe('750ms');
  });
});

test.describe('reports', () => {
  test('lists every tracked scenario', async ({ request, glitch, glitchScenario }) => {
    await glitch.latency('1ms');
    await request.get('/users');

    const reports = await glitch.report();
    expect(reports.map((report) => report.scenario)).toContain(glitchScenario);
  });

  test('reports an untracked scenario as a 404', async ({ glitch }) => {
    // A scenario exists only once rules have been overlaid onto it.
    await expect(glitch.scenarioReport('never-configured-scenario')).rejects.toThrow(GlitchResponseError);
  });

  test('carries the effective config alongside the metrics', async ({ request, glitch }) => {
    await glitch.latency('250ms');
    await request.get('/users');

    const report = await glitch.scenarioReport();
    expect(report.effective_config.latency.fixed).toBe('250ms');
    expect(report.status).toBe('active');
  });

  test('records the path and method of each request', async ({ request, glitch }) => {
    await glitch.latency('1ms');
    await request.get('/users');
    await request.post('/posts', { data: { title: 'Recorded' } });

    const report = await glitch.scenarioReport();
    const events = report.request_events ?? [];

    expect(events.some((event) => event.method === 'GET' && event.path === '/users')).toBe(true);
    expect(events.some((event) => event.method === 'POST' && event.path === '/posts')).toBe(true);
  });
});

test.describe('cross-scenario control', () => {
  test('drives another scenario through withScenario', async ({ request, glitch }) => {
    const other = glitch.withScenario('sibling-scenario');
    await other.fail(503);

    try {
      expect(
        (await request.get('/users', { headers: { [SCENARIO_HEADER]: 'sibling-scenario' } })).status(),
      ).toBe(503);

      expect((await request.get('/users')).status()).toBe(200);
    } finally {
      await other.reset();
    }
  });

  test('keeps many scenarios independent at once', async ({ request, glitch }) => {
    const codes = [418, 429, 502, 503];
    const clients = codes.map((code) => ({ code, client: glitch.withScenario(`multi-${code}`) }));

    await Promise.all(clients.map(({ code, client }) => client.fail(code)));

    try {
      const statuses = await Promise.all(
        clients.map(async ({ code }) =>
          (await request.get('/users', { headers: { [SCENARIO_HEADER]: `multi-${code}` } })).status(),
        ),
      );

      expect(statuses).toEqual(codes);
    } finally {
      await Promise.all(clients.map(({ client }) => client.reset()));
    }
  });
});

test.describe('input validation', () => {
  test('rejects a malformed duration before sending anything', async ({ glitch }) => {
    await expect(glitch.latency('2 seconds')).rejects.toThrow(GlitchInputError);
    await expect(glitch.latency('fast')).rejects.toThrow(/not a valid duration/);
  });

  test('rejects a malformed bandwidth', async ({ glitch }) => {
    await expect(glitch.throttle('50 gigabits')).rejects.toThrow(GlitchInputError);
  });

  test('rejects a percentage outside 0 to 100', async ({ glitch }) => {
    await expect(glitch.failRate(150)).rejects.toThrow(/between 0 and 100/);
    await expect(glitch.corrupt(-1)).rejects.toThrow(GlitchInputError);
  });

  test('rejects an implausible status code', async ({ glitch }) => {
    await expect(glitch.fail(99)).rejects.toThrow(GlitchInputError);
    await expect(glitch.fail(1000)).rejects.toThrow(GlitchInputError);
  });

  test('rejects a latency range missing a bound', async ({ glitch }) => {
    await expect(glitch.latency({ min: '100ms' })).rejects.toThrow(/needs both bounds/);
  });

  test('leaves the scenario untouched when input is rejected', async ({ request, glitch }) => {
    await glitch.latency('2 seconds').catch(() => undefined);

    // Nothing was sent, so the server never saw the bad value.
    expect((await glitch.config()).latency.fixed).toBe('0s');
    expect((await request.get('/users')).status()).toBe(200);
  });
});
