import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { GlitchClient } from '../src/client.ts';
import { BEARER_PREFIX, HTTP_HEADER, SCENARIO_HEADER } from '../src/constants.ts';
import { GlitchConnectionError, GlitchResponseError } from '../src/errors.ts';
import { type RecordedRequest, type StubServer, startStubServer } from './stub-server.ts';

/** Node lowercases incoming header names, so lookups normalize before reading. */
function header(request: RecordedRequest | undefined, name: string): string | undefined {
  return request?.headers[name.toLowerCase()];
}

describe('GlitchClient', () => {
  let server: StubServer;
  let glitch: GlitchClient;

  before(async () => {
    server = await startStubServer();
  });

  after(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.requests.length = 0;
    glitch = new GlitchClient({ url: server.url, scenario: 'checkout' });
  });

  it('scopes every call to its scenario', async () => {
    await glitch.health();
    assert.equal(header(server.requests[0], SCENARIO_HEADER), 'checkout');
  });

  it('sends a status-specific failure for fail()', async () => {
    await glitch.fail(503);
    assert.deepEqual(JSON.parse(server.requests[0]?.body ?? '{}'), {
      failure: { statuses: [{ code: 503, rate: 100 }] },
    });
  });

  it('sends an overall rate for failRate()', async () => {
    await glitch.failRate(20);
    assert.deepEqual(JSON.parse(server.requests[0]?.body ?? '{}'), { failure: { rate: 20 } });
  });

  it('accepts a bare duration or a range for latency()', async () => {
    await glitch.latency('2s');
    await glitch.latency({ min: 200, max: 1500, distribution: 'uniform' });

    assert.deepEqual(JSON.parse(server.requests[0]?.body ?? '{}'), { latency: { fixed: '2s' } });
    assert.deepEqual(JSON.parse(server.requests[1]?.body ?? '{}'), {
      latency: { min: '200ms', max: '1500ms', distribution: 'uniform' },
    });
  });

  it('resets before applying when set() is used', async () => {
    await glitch.set({ failure: { rate: 10 } });

    assert.deepEqual(
      server.requests.map((request) => `${request.method} ${request.path}`),
      ['DELETE /_glitch/rules', 'PATCH /_glitch/rules'],
    );
  });

  it('does not reset when merge() is used', async () => {
    await glitch.merge({ failure: { rate: 10 } });
    assert.deepEqual(
      server.requests.map((request) => request.method),
      ['PATCH'],
    );
  });

  it('applies a failsafe timeout to pause by default', async () => {
    await glitch.pause();
    assert.equal(server.requests[0]?.path, '/_glitch/pause?timeout=30s');
  });

  it('honours an explicit pause timeout', async () => {
    await glitch.pause({ timeout: 5000 });
    assert.equal(server.requests[0]?.path, '/_glitch/pause?timeout=5000ms');
  });

  it('resumes after paused() resolves', async () => {
    const result = await glitch.paused(async () => 'asserted');

    assert.equal(result, 'asserted');
    assert.deepEqual(
      server.requests.map((request) => request.path.split('?')[0]),
      ['/_glitch/pause', '/_glitch/resume'],
    );
  });

  it('resumes even when the callback throws', async () => {
    await assert.rejects(
      glitch.paused(async () => {
        throw new Error('assertion failed');
      }),
      /assertion failed/,
    );

    assert.deepEqual(
      server.requests.map((request) => request.path.split('?')[0]),
      ['/_glitch/pause', '/_glitch/resume'],
    );
  });

  it('normalizes a null report list to an empty array', async () => {
    assert.deepEqual(await glitch.report(), []);
  });

  it('targets its own scenario when asked for a report', async () => {
    await glitch.scenarioReport();
    assert.equal(server.requests[0]?.path, '/_glitch/scenarios/checkout/report');
  });

  it('reuses the transport when switching scenarios', async () => {
    await glitch.withScenario('other').health();
    assert.equal(header(server.requests[0], SCENARIO_HEADER), 'other');
  });

  it('surfaces the server error message on a failed call', async () => {
    server.respondNextWith(404, JSON.stringify({ error: 'profile not found' }));

    await assert.rejects(glitch.profile('nope'), (error: unknown) => {
      assert.ok(error instanceof GlitchResponseError);
      assert.equal(error.status, 404);
      assert.match(error.message, /profile not found/);
      return true;
    });
  });

  it('explains how to authenticate on a 401', async () => {
    server.respondNextWith(401, JSON.stringify({ error: 'unauthorized control API access' }));

    await assert.rejects(glitch.health(), (error: unknown) => {
      assert.ok(error instanceof GlitchResponseError);
      assert.match(error.message, /GLITCH_TOKEN/);
      return true;
    });
  });

  it('explains that Glitch is unreachable rather than leaking a socket error', async () => {
    const offline = new GlitchClient({ url: 'http://127.0.0.1:1' });

    await assert.rejects(offline.health(), (error: unknown) => {
      assert.ok(error instanceof GlitchConnectionError);
      assert.match(error.message, /Is Glitch running/);
      return true;
    });
  });

  it('sends a bearer token when one is configured', async () => {
    await new GlitchClient({ url: server.url, token: 'secret' }).health();
    assert.equal(header(server.requests[0], HTTP_HEADER.authorization), `${BEARER_PREFIX}secret`);
  });
});
