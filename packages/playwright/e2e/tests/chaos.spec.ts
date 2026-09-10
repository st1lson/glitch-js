/**
 * End-to-end coverage for each chaos primitive the SDK exposes.
 *
 * Rates are pinned to 100 wherever an assertion depends on the outcome, so the
 * suite does not rely on a dice roll. The one statistical test uses a sample
 * large enough that its bounds are many standard deviations wide.
 */
import { expect, test } from 'glitch-playwright';

import { LARGE_COLLECTION } from '../constants.ts';

test.describe('latency', () => {
  test('applies a fixed delay', async ({ request, glitch }) => {
    await glitch.latency('600ms');

    const started = Date.now();
    const response = await request.get('/users');
    const elapsed = Date.now() - started;

    expect(response.status()).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(550);
  });

  test('accepts milliseconds as a number', async ({ request, glitch }) => {
    await glitch.latency(500);

    const config = await glitch.config();
    expect(config.latency.fixed).toBe('500ms');

    const started = Date.now();
    await request.get('/users');
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  });

  test('stays inside a uniform range', async ({ request, glitch }) => {
    await glitch.latency({ min: '400ms', max: '700ms', distribution: 'uniform' });

    const started = Date.now();
    await request.get('/users');
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(3000);
  });

  test('accepts a normal distribution', async ({ request, glitch }) => {
    await glitch.latency({ min: '300ms', max: '600ms', distribution: 'normal' });

    const config = await glitch.config();
    expect(config.latency.distribution).toBe('normal');

    const started = Date.now();
    await request.get('/users');
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  test('records the delay it added in the report', async ({ request, glitch }) => {
    await glitch.latency('300ms');
    await request.get('/users');

    const report = await glitch.scenarioReport();
    expect(report.metrics.total_latency_added_ms).toBeGreaterThanOrEqual(250);
  });

  test('records the request itself in the report', async ({ request, glitch }) => {
    await glitch.latency('300ms');
    await request.get('/users');

    const report = await glitch.scenarioReport();
    expect(report.metrics.requests).toBeGreaterThanOrEqual(1);
    expect(report.metrics.total_duration_ms).toBeGreaterThanOrEqual(250);
  });
});

test.describe('failure', () => {
  test('returns the exact status code requested', async ({ request, glitch }) => {
    for (const code of [400, 429, 500, 502, 503, 504]) {
      await glitch.set({ failure: { statuses: [{ code, rate: 100 }] } });
      expect((await request.get('/users')).status(), `status ${code}`).toBe(code);
    }
  });

  test('returns 500 for a bare failure rate', async ({ request, glitch }) => {
    await glitch.failRate(100);
    expect((await request.get('/users')).status()).toBe(500);
  });

  test('picks the first matching status when several are configured', async ({ request, glitch }) => {
    await glitch.set({
      failure: {
        statuses: [
          { code: 503, rate: 100 },
          { code: 429, rate: 100 },
        ],
      },
    });

    // The server rolls each status in order and returns the first that hits, so
    // a leading 100% entry wins outright.
    expect((await request.get('/users')).status()).toBe(503);
  });

  test('honours a partial rate across many requests', async ({ request, glitch }) => {
    await glitch.fail(429, 50);

    const samples = 60;
    const statuses = await Promise.all(
      Array.from({ length: samples }, async () => (await request.get('/users')).status()),
    );
    const failed = statuses.filter((status) => status === 429).length;

    // Binomial(60, 0.5) has a standard deviation near 3.9, so this range is
    // wide enough that a passing build is not luck.
    expect(failed).toBeGreaterThan(10);
    expect(failed).toBeLessThan(50);
  });

  test('leaves requests alone at a rate of zero', async ({ request, glitch }) => {
    await glitch.set({ failure: { statuses: [{ code: 503, rate: 0 }] } });
    expect((await request.get('/users')).status()).toBe(200);
  });

  test('counts failures in the report', async ({ request, glitch }) => {
    await glitch.fail(503);
    await request.get('/users');
    await request.get('/users');

    const report = await glitch.scenarioReport();
    expect(report.metrics.failures).toBeGreaterThanOrEqual(2);
  });

  test('records the failed requests in the report', async ({ request, glitch }) => {
    await glitch.fail(503);
    await request.get('/users');
    await request.get('/users');

    const report = await glitch.scenarioReport();
    const statuses = (report.request_events ?? []).map((event) => event.status);
    expect(statuses.filter((status) => status === 503).length).toBeGreaterThanOrEqual(2);
  });

  test('fails writes as well as reads', async ({ request, glitch }) => {
    await glitch.fail(503);

    const response = await request.post('/posts', { data: { title: 'New' } });
    expect(response.status()).toBe(503);
  });
});

test.describe('bandwidth', () => {
  test('paces a large response', async ({ request, glitch }) => {
    // 64 kbps is 65536 bytes per second, and the payload is around 64 KB, so
    // the transfer should take roughly a second.
    await glitch.throttle('64kbps');

    const started = Date.now();
    const response = await request.get(LARGE_COLLECTION);
    const elapsed = Date.now() - started;

    expect(response.status()).toBe(200);
    expect((await response.body()).byteLength).toBeGreaterThan(50_000);
    expect(elapsed).toBeGreaterThanOrEqual(600);
  });

  test('accepts a raw byte-per-second number', async ({ glitch }) => {
    await glitch.throttle(65_536);

    // The server stores bandwidth as a string alongside its parsed byte rate
    // and marshals the string back, so a number sent in comes back quoted.
    expect((await glitch.config()).bandwidth).toBe('65536');
  });

  test('leaves a small response effectively untouched', async ({ request, glitch }) => {
    await glitch.throttle('1mbps');

    const started = Date.now();
    await request.get('/users');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

test.describe('corruption', () => {
  test('breaks JSON syntax on demand', async ({ request, glitch }) => {
    await glitch.corruptWith(100, ['break_syntax']);

    const body = await (await request.get('/users')).text();
    expect(() => JSON.parse(body) as unknown).toThrow();
  });

  test('drops a field while keeping the payload parseable', async ({ request, glitch }) => {
    const original = await (await request.get('/users')).text();
    await glitch.corruptWith(100, ['drop_field']);

    const corrupted = await (await request.get('/users')).text();
    expect(corrupted).not.toBe(original);
    expect(() => JSON.parse(corrupted) as unknown).not.toThrow();
  });

  test('injects nulls', async ({ request, glitch }) => {
    const original = await (await request.get('/users')).text();
    await glitch.corruptWith(100, ['inject_null']);

    const corrupted = await (await request.get('/users')).text();
    expect(corrupted).not.toBe(original);
  });

  test('swaps value types', async ({ request, glitch }) => {
    const original = await (await request.get('/users')).text();
    await glitch.corruptWith(100, ['swap_type']);

    const corrupted = await (await request.get('/users')).text();
    expect(corrupted).not.toBe(original);
  });

  test('applies several mutators when multi is set', async ({ request, glitch }) => {
    const original = await (await request.get('/users')).text();
    await glitch.corruptWith(100, ['drop_field', 'inject_null'], true);

    const corrupted = await (await request.get('/users')).text();
    expect(corrupted).not.toBe(original);
  });

  test('leaves payloads alone at a rate of zero', async ({ request, glitch }) => {
    const original = await (await request.get('/users')).text();
    await glitch.corrupt(0);

    expect(await (await request.get('/users')).text()).toBe(original);
  });

  test('counts corrupted payloads in the report', async ({ request, glitch }) => {
    await glitch.corrupt(100);
    await request.get('/users');

    const report = await glitch.scenarioReport();
    expect(report.metrics.corrupted_payloads).toBeGreaterThanOrEqual(1);
  });
});

test.describe('stall', () => {
  test('drops the connection part-way through the response', async ({ request, glitch }) => {
    // The API streams chunked, so the server has no Content-Length to take a
    // percentage of and falls back to assuming a 200 KB payload. dropAt has to
    // be low enough that the real 64 KB body crosses the resulting threshold.
    await glitch.stall({ rate: 100, mode: 'drop', dropAt: 10 });

    // The server aborts the handler mid-body, which surfaces as a transport
    // error rather than an HTTP status.
    await expect(request.get(LARGE_COLLECTION)).rejects.toThrow();
  });

  test('leaves requests alone at a rate of zero', async ({ request, glitch }) => {
    await glitch.stall({ rate: 0, mode: 'drop', dropAt: 50 });
    expect((await request.get(LARGE_COLLECTION)).status()).toBe(200);
  });

  test('counts stalls in the report', async ({ request, glitch }) => {
    await glitch.stall({ rate: 100, mode: 'drop', dropAt: 10 });
    await request.get(LARGE_COLLECTION).catch(() => undefined);

    const report = await glitch.scenarioReport();
    expect(report.metrics.stalls).toBeGreaterThanOrEqual(1);
    expect((report.request_events ?? []).some((event) => event.chaos_stalled)).toBe(true);
  });

  test('reports the configured stall settings', async ({ glitch }) => {
    await glitch.stall({ rate: 40, mode: 'hang', dropAt: 25 });

    const config = await glitch.config();
    expect(config.stall).toMatchObject({ rate: 40, mode: 'hang', drop_at: 25 });
  });
});

test.describe('combinations', () => {
  test('layers latency and failure on the same scenario', async ({ request, glitch }) => {
    await glitch.latency('400ms');
    await glitch.fail(503);

    const started = Date.now();
    const response = await request.get('/users');

    expect(response.status()).toBe(503);
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
  });

  test('layers throttling and corruption', async ({ request, glitch }) => {
    await glitch.throttle('512kbps');
    await glitch.corruptWith(100, ['break_syntax']);

    const body = await (await request.get('/users')).text();
    expect(() => JSON.parse(body) as unknown).toThrow();
  });
});
