import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GlitchInputError } from '../src/errors.ts';
import { serializeBandwidth, serializeChaos, serializeDuration } from '../src/serialize.ts';

describe('serializeDuration', () => {
  it('treats numbers as milliseconds', () => {
    assert.equal(serializeDuration(2000), '2000ms');
    assert.equal(serializeDuration(0), '0ms');
  });

  it('passes through Go duration strings', () => {
    assert.equal(serializeDuration('250ms'), '250ms');
    assert.equal(serializeDuration('1m30s'), '1m30s');
    assert.equal(serializeDuration('1.5h'), '1.5h');
    assert.equal(serializeDuration('  2s  '), '2s');
  });

  it('normalizes a bare zero', () => {
    assert.equal(serializeDuration('0'), '0s');
  });

  it('rejects values Go could not parse', () => {
    assert.throws(() => serializeDuration('2 seconds'), GlitchInputError);
    assert.throws(() => serializeDuration('fast'), GlitchInputError);
    assert.throws(() => serializeDuration(''), GlitchInputError);
    assert.throws(() => serializeDuration(-1), GlitchInputError);
    assert.throws(() => serializeDuration(Number.NaN), GlitchInputError);
  });
});

describe('serializeBandwidth', () => {
  it('keeps numbers as bytes per second', () => {
    assert.equal(serializeBandwidth(51200), 51200);
    assert.equal(serializeBandwidth(1024.6), 1025);
  });

  it('accepts every suffix ParseBandwidth understands', () => {
    for (const value of ['50kbps', '1mbps', '5kb/s', '2mb/s', '900bps', '900b/s', '4096']) {
      assert.equal(serializeBandwidth(value), value);
    }
  });

  it('rejects unknown units', () => {
    assert.throws(() => serializeBandwidth('50 gigabits'), GlitchInputError);
    assert.throws(() => serializeBandwidth(-1), GlitchInputError);
  });
});

describe('serializeChaos', () => {
  it('renames camelCase inputs to the snake_case wire format', () => {
    const payload = serializeChaos({
      stall: { rate: 25, mode: 'hang', dropAt: 80 },
      realtime: { dropRate: 10, disconnectRate: 5, outOfOrder: true, maxBufferedMessages: 50 },
    });

    assert.deepEqual(payload, {
      stall: { rate: 25, mode: 'hang', drop_at: 80 },
      realtime: { drop_rate: 10, disconnect_rate: 5, out_of_order: true, max_buffered_messages: 50 },
    });
  });

  it('omits keys that were never set', () => {
    assert.deepEqual(serializeChaos({ failure: { rate: 20 } }), { failure: { rate: 20 } });
    assert.deepEqual(serializeChaos({}), {});
  });

  it('defaults a status rate to 100 so a code is deterministic', () => {
    assert.deepEqual(serializeChaos({ failure: { statuses: [{ code: 503 }] } }), {
      failure: { statuses: [{ code: 503, rate: 100 }] },
    });
  });

  it('converts durations everywhere they appear', () => {
    const payload = serializeChaos({
      latency: { min: 200, max: '1.5s', distribution: 'normal' },
      monkey: { phases: [{ duration: 30_000, failure: { rate: 100 } }] },
    });

    assert.deepEqual(payload, {
      latency: { min: '200ms', max: '1.5s', distribution: 'normal' },
      monkey: { phases: [{ duration: '30000ms', failure: { rate: 100 } }] },
    });
  });

  it('uppercases route methods and renames operationId', () => {
    const payload = serializeChaos({
      routes: [{ path: '/api/checkout', method: 'post', operationId: 'createOrder', failure: { rate: 50 } }],
    });

    assert.deepEqual(payload, {
      routes: [
        {
          path: '/api/checkout',
          method: 'POST',
          operation_id: 'createOrder',
          failure: { rate: 50 },
        },
      ],
    });
  });

  it('rejects a latency range missing one of its bounds', () => {
    assert.throws(() => serializeChaos({ latency: { min: 100 } }), GlitchInputError);
    assert.throws(() => serializeChaos({ latency: { max: 100 } }), GlitchInputError);
  });

  it('rejects percentages outside 0 to 100', () => {
    assert.throws(() => serializeChaos({ failure: { rate: 120 } }), GlitchInputError);
    assert.throws(() => serializeChaos({ corruption: { rate: -5 } }), GlitchInputError);
  });

  it('rejects status codes outside the HTTP range', () => {
    assert.throws(() => serializeChaos({ failure: { statuses: [{ code: 99 }] } }), GlitchInputError);
    assert.throws(() => serializeChaos({ failure: { statuses: [{ code: 1000 }] } }), GlitchInputError);
  });

  it('rejects a route with nothing to match on', () => {
    assert.throws(() => serializeChaos({ routes: [{ failure: { rate: 100 } }] }), GlitchInputError);
    assert.throws(() => serializeChaos({ routes: [{}] }), GlitchInputError);
  });

  it('accepts a route matching on any single predicate', () => {
    // The server builds one predicate per matcher present, so a method, header
    // or body condition is enough on its own.
    for (const route of [
      { method: 'GET' },
      { headers: { 'X-Tenant': 'acme' } },
      { query: { role: 'admin' } },
      { body: [{ field: 'title' }] },
      { operationId: 'createOrder' },
    ]) {
      assert.doesNotThrow(() => serializeChaos({ routes: [route] }), JSON.stringify(route));
    }
  });
});
