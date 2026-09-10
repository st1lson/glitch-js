/**
 * Realtime chaos over Server-Sent Events.
 *
 * This spec runs against the "realtime" project, where Glitch reverse-proxies a
 * small SSE origin. The JSON database engine serves no streaming endpoints, so
 * proxying is the only way to reach the realtime middleware at all.
 *
 * The origin emits 20 sequenced events and closes, which lets a test detect
 * drops and reordering without depending on timing.
 */
import { expect, test } from 'glitch-playwright';

const EVENT_COUNT = 20;

/** Reads an SSE stream to completion and returns the sequence numbers seen. */
async function collectSequence(body: string): Promise<number[]> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as { seq: number })
    .map((payload) => payload.seq);
}

test('passes the stream through untouched with no chaos configured', async ({ request }) => {
  const response = await request.get('/events', { headers: { Accept: 'text/event-stream' } });

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/event-stream');

  const sequence = await collectSequence(await response.text());
  expect(sequence).toEqual(Array.from({ length: EVENT_COUNT }, (_, index) => index));
});

test('drops messages at the configured rate', async ({ request, glitch }) => {
  await glitch.realtime({ dropRate: 100 });

  const response = await request.get('/events', { headers: { Accept: 'text/event-stream' } });
  const sequence = await collectSequence(await response.text());

  expect(sequence).toHaveLength(0);
});

test('keeps messages when the drop rate is zero', async ({ request, glitch }) => {
  await glitch.realtime({ dropRate: 0, disconnectRate: 0 });

  const response = await request.get('/events', { headers: { Accept: 'text/event-stream' } });
  const sequence = await collectSequence(await response.text());

  expect(sequence).toEqual(Array.from({ length: EVENT_COUNT }, (_, index) => index));
});

test('loses some but not all messages at a partial drop rate', async ({ request, glitch }) => {
  await glitch.realtime({ dropRate: 50 });

  const response = await request.get('/events', { headers: { Accept: 'text/event-stream' } });
  const sequence = await collectSequence(await response.text());

  // Binomial(20, 0.5) practically never lands on 0 or 20.
  expect(sequence.length).toBeGreaterThan(0);
  expect(sequence.length).toBeLessThan(EVENT_COUNT);
});

test('delays messages', async ({ request, glitch }) => {
  await glitch.realtime({ latency: { fixed: '50ms' } });

  const started = Date.now();
  const response = await request.get('/events', { headers: { Accept: 'text/event-stream' } });
  await response.text();
  const elapsed = Date.now() - started;

  // 20 events, each held 50ms, against an origin that would finish in ~200ms.
  expect(elapsed).toBeGreaterThanOrEqual(500);
});

test('delivers messages out of order when asked', async ({ request, glitch }) => {
  await glitch.realtime({ outOfOrder: true, maxBufferedMessages: 10 });

  const response = await request.get('/events', { headers: { Accept: 'text/event-stream' } });
  const sequence = await collectSequence(await response.text());

  expect(sequence.length).toBeGreaterThan(0);

  const sorted = [...sequence].sort((a, b) => a - b);
  expect(sequence).not.toEqual(sorted);
});

test('leaves plain requests alone while realtime chaos is on', async ({ request, glitch }) => {
  await glitch.realtime({ dropRate: 100 });

  // The realtime middleware only engages on SSE and WebSocket traffic, so an
  // ordinary request is untouched even at a 100% drop rate.
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
});

test('round-trips its configuration', async ({ glitch }) => {
  await glitch.realtime({
    dropRate: 10,
    disconnectRate: 5,
    outOfOrder: true,
    maxBufferedMessages: 50,
    latency: { fixed: '25ms' },
  });

  const config = await glitch.config();
  expect(config.realtime).toMatchObject({
    drop_rate: 10,
    disconnect_rate: 5,
    out_of_order: true,
    max_buffered_messages: 50,
  });
  expect(config.realtime.latency.fixed).toBe('25ms');
});

test('severs the stream at a full disconnect rate', async ({ request, glitch }) => {
  await glitch.realtime({ disconnectRate: 100 });

  // The server aborts the handler on the first event, so the client sees the
  // connection drop rather than a short but well-formed stream.
  await expect(request.get('/events', { headers: { Accept: 'text/event-stream' } })).rejects.toThrow();
});

test('keeps the stream intact at a zero disconnect rate', async ({ request, glitch }) => {
  await glitch.realtime({ disconnectRate: 0, dropRate: 0 });

  const response = await request.get('/events', { headers: { Accept: 'text/event-stream' } });
  expect(await collectSequence(await response.text())).toHaveLength(EVENT_COUNT);
});
