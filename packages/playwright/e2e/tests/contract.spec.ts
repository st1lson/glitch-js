/**
 * Drift guard between the Go config schema and the TypeScript types.
 *
 * The types in `glitch-core` are written by hand, which keeps the SDK
 * dependency-free but means nothing stops them drifting from the Go structs.
 * This spec pins the real server's payload shape. When someone adds, renames or
 * removes a config field on the Go side, this fails, and the fix is to update
 * the key list here alongside the type.
 */
import { expect, test } from 'glitch-playwright';

/** Keys the Go Config struct always marshals. Mirrors the GlitchConfig type. */
const CONFIG_KEYS = [
  'bandwidth',
  'control_token',
  'corruption',
  'failure',
  'file',
  'host',
  'insecure_control_api',
  'latency',
  'monkey',
  'no_tui',
  'port',
  'proxy',
  'read_only',
  'realtime',
  'routes',
  'stall',
  'verbose',
];

/** Keys carrying `omitempty`, so they appear only when set. */
const OPTIONAL_CONFIG_KEYS = ['seed', 'report_path', 'report_format'];

const NESTED_KEYS: Record<string, string[]> = {
  latency: ['distribution', 'fixed', 'max', 'min'],
  failure: ['rate', 'statuses'],
  stall: ['drop_at', 'mode', 'rate'],
  corruption: ['multi', 'rate', 'strategies'],
  monkey: ['enabled', 'phases'],
  realtime: ['disconnect_rate', 'drop_rate', 'latency', 'max_buffered_messages', 'out_of_order'],
};

test('the config payload matches the declared type', async ({ glitch }) => {
  const baseline = await glitch.baseline();
  const present = Object.keys(baseline).sort();

  expect(present.filter((key) => !OPTIONAL_CONFIG_KEYS.includes(key))).toEqual(CONFIG_KEYS);
  expect(present.filter((key) => !CONFIG_KEYS.includes(key) && !OPTIONAL_CONFIG_KEYS.includes(key))).toEqual(
    [],
  );
});

test('nested chaos sections match the declared types', async ({ glitch }) => {
  const baseline = await glitch.baseline();

  for (const [section, keys] of Object.entries(NESTED_KEYS)) {
    const value = baseline[section as keyof typeof baseline] as Record<string, unknown>;
    expect(Object.keys(value).sort(), `config.${section}`).toEqual(keys);
  }
});

test('durations come back as strings the SDK can round-trip', async ({ glitch }) => {
  await glitch.latency({ min: 200, max: '1.5s', distribution: 'uniform' });

  const config = await glitch.config();
  expect(config.latency.min).toBe('200ms');
  expect(config.latency.max).toBe('1.5s');
  expect(config.latency.distribution).toBe('uniform');
});

test('the health payload matches the declared type', async ({ glitch, glitchScenario }) => {
  const health = await glitch.health();

  expect(Object.keys(health).sort()).toEqual(['paused', 'scenario', 'status']);
  expect(health.scenario).toBe(glitchScenario);
  expect(health.paused).toBe(false);
});

test('the profiles payload matches the declared type', async ({ glitch }) => {
  const profiles = await glitch.profiles();

  expect(Object.keys(profiles).sort()).toEqual(['builtin', 'custom']);
  expect(profiles.builtin).toEqual(['mobile', '3g', 'bad-wifi', 'production']);
});

test('the scenario report payload matches the declared type', async ({ request, glitch }) => {
  // A scenario is only tracked once rules have been overlaid onto it.
  await glitch.latency('1ms');
  await request.get('/users');

  const report = await glitch.scenarioReport();

  expect(Object.keys(report).sort()).toEqual([
    'effective_config',
    'metrics',
    'request_events',
    'scenario',
    'seed',
    'status',
  ]);
  expect(Object.keys(report.metrics).sort()).toEqual([
    'corrupted_payloads',
    'failures',
    'requests',
    'stalls',
    'total_bytes_written',
    'total_duration_ms',
    'total_latency_added_ms',
  ]);
  expect(report.metrics.requests).toBeGreaterThan(0);

  const [event] = report.request_events ?? [];
  expect(event).toBeDefined();
  for (const key of ['timestamp', 'method', 'path', 'status', 'duration_ms']) {
    expect(event, `request event is missing ${key}`).toHaveProperty(key);
  }
});
