/**
 * Route-scoped chaos: breaking one endpoint while the rest stays healthy.
 *
 * The server builds one predicate per matcher on a route and requires them all
 * to hold, scoring each match so the most specific route wins. These tests
 * cover each matcher on its own, then the interactions between them.
 */
import { expect, test } from 'glitch-playwright';

import { LARGE_COLLECTION } from '../constants.ts';

test.describe('path matching', () => {
  test('breaks one collection and leaves the others alone', async ({ request, glitch }) => {
    await glitch.routes([{ path: '/users', failure: { statuses: [{ code: 503, rate: 100 }] } }]);

    expect((await request.get('/users')).status()).toBe(503);
    expect((await request.get('/posts')).status()).toBe(200);
  });

  test('matches a trailing wildcard', async ({ request, glitch }) => {
    await glitch.routes([{ path: '/users/*', failure: { statuses: [{ code: 418, rate: 100 }] } }]);

    expect((await request.get('/users/1')).status()).toBe(418);
    // The wildcard covers children, not the collection itself.
    expect((await request.get('/users')).status()).toBe(200);
  });

  test('matches every path with a bare wildcard', async ({ request, glitch }) => {
    await glitch.routes([{ path: '*', failure: { statuses: [{ code: 503, rate: 100 }] } }]);

    expect((await request.get('/users')).status()).toBe(503);
    expect((await request.get('/posts')).status()).toBe(503);
  });

  test('prefers the most specific route when several match', async ({ request, glitch }) => {
    await glitch.routes([
      { path: '*', failure: { statuses: [{ code: 500, rate: 100 }] } },
      { path: '/users', failure: { statuses: [{ code: 418, rate: 100 }] } },
    ]);

    expect((await request.get('/users')).status()).toBe(418);
    expect((await request.get('/posts')).status()).toBe(500);
  });
});

test.describe('method matching', () => {
  test('breaks writes and leaves reads alone', async ({ request, glitch }) => {
    await glitch.routes([
      { path: '/posts', method: 'POST', failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    expect((await request.get('/posts')).status()).toBe(200);
    expect((await request.post('/posts', { data: { title: 'New' } })).status()).toBe(503);
  });

  test('accepts a lowercase method', async ({ request, glitch }) => {
    await glitch.routes([
      { path: '/posts', method: 'post', failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    expect((await request.post('/posts', { data: { title: 'New' } })).status()).toBe(503);
    expect((await request.get('/posts')).status()).toBe(200);
  });

  test('distinguishes PUT, PATCH and DELETE', async ({ request, glitch }) => {
    await glitch.routes([
      { path: '/users/*', method: 'DELETE', failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    expect((await request.patch('/users/1', { data: { name: 'Renamed' } })).status()).toBe(200);
    expect((await request.delete('/users/2')).status()).toBe(503);
  });
});

test.describe('header matching', () => {
  test('breaks only requests carrying the header', async ({ request, glitch }) => {
    await glitch.routes([
      { path: '/users', headers: { 'X-Tenant': 'acme' }, failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    expect((await request.get('/users', { headers: { 'X-Tenant': 'acme' } })).status()).toBe(503);
    expect((await request.get('/users', { headers: { 'X-Tenant': 'other' } })).status()).toBe(200);
    expect((await request.get('/users')).status()).toBe(200);
  });

  test('compares header values case-insensitively', async ({ request, glitch }) => {
    await glitch.routes([
      { path: '/users', headers: { 'X-Tenant': 'acme' }, failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    expect((await request.get('/users', { headers: { 'x-tenant': 'ACME' } })).status()).toBe(503);
  });

  test('requires every listed header to be present', async ({ request, glitch }) => {
    await glitch.routes([
      {
        path: '/users',
        headers: { 'X-Tenant': 'acme', 'X-Region': 'eu' },
        failure: { statuses: [{ code: 503, rate: 100 }] },
      },
    ]);

    expect((await request.get('/users', { headers: { 'X-Tenant': 'acme' } })).status()).toBe(200);
    expect(
      (await request.get('/users', { headers: { 'X-Tenant': 'acme', 'X-Region': 'eu' } })).status(),
    ).toBe(503);
  });
});

test.describe('query matching', () => {
  test('breaks only requests carrying the query parameter', async ({ request, glitch }) => {
    await glitch.routes([
      { path: '/users', query: { role: 'admin' }, failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    expect((await request.get('/users?role=admin')).status()).toBe(503);
    expect((await request.get('/users?role=user')).status()).toBe(200);
    expect((await request.get('/users')).status()).toBe(200);
  });

  test('requires every listed parameter', async ({ request, glitch }) => {
    await glitch.routes([
      {
        path: '/users',
        query: { role: 'admin', page: '2' },
        failure: { statuses: [{ code: 503, rate: 100 }] },
      },
    ]);

    expect((await request.get('/users?role=admin')).status()).toBe(200);
    expect((await request.get('/users?role=admin&page=2')).status()).toBe(503);
  });
});

test.describe('body matching', () => {
  test('breaks a write based on a field value', async ({ request, glitch }) => {
    await glitch.routes([
      {
        path: '/posts',
        method: 'POST',
        body: [{ field: 'title', op: 'eq', value: 'Boom' }],
        failure: { statuses: [{ code: 503, rate: 100 }] },
      },
    ]);

    expect((await request.post('/posts', { data: { title: 'Boom' } })).status()).toBe(503);
    expect((await request.post('/posts', { data: { title: 'Fine' } })).status()).toBe(201);
  });

  test('supports the exists operator', async ({ request, glitch }) => {
    await glitch.routes([
      {
        path: '/posts',
        method: 'POST',
        body: [{ field: 'draft', op: 'exists' }],
        failure: { statuses: [{ code: 503, rate: 100 }] },
      },
    ]);

    expect((await request.post('/posts', { data: { title: 'A', draft: true } })).status()).toBe(503);
    expect((await request.post('/posts', { data: { title: 'B' } })).status()).toBe(201);
  });

  test('supports contains and prefix operators', async ({ request, glitch }) => {
    await glitch.routes([
      {
        path: '/posts',
        method: 'POST',
        body: [{ field: 'title', op: 'prefix', value: 'urgent' }],
        failure: { statuses: [{ code: 503, rate: 100 }] },
      },
    ]);

    expect((await request.post('/posts', { data: { title: 'urgent: fix' } })).status()).toBe(503);
    expect((await request.post('/posts', { data: { title: 'later: fix' } })).status()).toBe(201);
  });

  test('reads a nested field', async ({ request, glitch }) => {
    await glitch.routes([
      {
        path: '/posts',
        method: 'POST',
        body: [{ field: 'author.role', op: 'eq', value: 'admin' }],
        failure: { statuses: [{ code: 503, rate: 100 }] },
      },
    ]);

    expect((await request.post('/posts', { data: { title: 'A', author: { role: 'admin' } } })).status()).toBe(
      503,
    );
    expect((await request.post('/posts', { data: { title: 'B', author: { role: 'user' } } })).status()).toBe(
      201,
    );
  });
});

test.describe('route chaos other than failure', () => {
  test('applies latency to one path only', async ({ request, glitch }) => {
    await glitch.routes([{ path: '/users', latency: { fixed: '600ms' } }]);

    const slowStarted = Date.now();
    await request.get('/users');
    const slow = Date.now() - slowStarted;

    const fastStarted = Date.now();
    await request.get('/posts');
    const fast = Date.now() - fastStarted;

    expect(slow).toBeGreaterThanOrEqual(550);
    // Compared against the other path rather than an absolute ceiling, so
    // contention from parallel workers cannot fail this.
    expect(slow - fast).toBeGreaterThan(400);
  });

  test('applies corruption to one path only', async ({ request, glitch }) => {
    await glitch.routes([{ path: '/users', corruption: { rate: 100, strategies: ['break_syntax'] } }]);

    const users = await (await request.get('/users')).text();
    const posts = await (await request.get('/posts')).text();

    expect(() => JSON.parse(users) as unknown).toThrow();
    expect(() => JSON.parse(posts) as unknown).not.toThrow();
  });

  test('applies bandwidth to one path only', async ({ request, glitch }) => {
    await glitch.routes([{ path: LARGE_COLLECTION, bandwidth: '64kbps' }]);

    const started = Date.now();
    await request.get(LARGE_COLLECTION);
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
  });
});

test.describe('route list semantics', () => {
  test('replaces the whole list rather than appending to it', async ({ request, glitch }) => {
    await glitch.routes([{ path: '/users', failure: { statuses: [{ code: 503, rate: 100 }] } }]);
    expect((await request.get('/users')).status()).toBe(503);

    // A second call overwrites, because the server assigns the route slice
    // wholesale instead of merging entry by entry.
    await glitch.routes([{ path: '/posts', failure: { statuses: [{ code: 503, rate: 100 }] } }]);

    expect((await request.get('/users')).status()).toBe(200);
    expect((await request.get('/posts')).status()).toBe(503);
  });

  test('rejects a route with nothing to match on', async ({ glitch }) => {
    // Caught in the SDK before any request is sent, because such a route would
    // silently match everything.
    await expect(glitch.routes([{ failure: { rate: 100 } }])).rejects.toThrow(/nothing to match on/);
  });

  test('allows a route that matches on a header alone', async ({ request, glitch }) => {
    await glitch.routes([
      { headers: { 'X-Break': 'yes' }, failure: { statuses: [{ code: 503, rate: 100 }] } },
    ]);

    expect((await request.get('/users', { headers: { 'X-Break': 'yes' } })).status()).toBe(503);
    expect((await request.get('/users')).status()).toBe(200);
  });
});
