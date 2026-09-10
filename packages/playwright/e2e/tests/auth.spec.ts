/**
 * Control API authentication.
 *
 * This spec runs against the "auth" project, whose Glitch instance is started
 * with --control-token. Once a token is configured the server stops trusting
 * loopback, so every control call needs the bearer header.
 */
import { expect, GlitchClient, GlitchResponseError, test } from 'glitch-playwright';

import { CONTROL_TOKEN } from '../constants.ts';

test('accepts a configured token', async ({ glitch }) => {
  expect((await glitch.health()).status).toBe('ok');
});

test('drives chaos over the authenticated control API', async ({ request, glitch }) => {
  await glitch.fail(503);
  expect((await request.get('/users')).status()).toBe(503);
});

test('reads the token from the environment when none is passed', async ({ glitch }) => {
  const previous = process.env.GLITCH_TOKEN;
  process.env.GLITCH_TOKEN = CONTROL_TOKEN;

  try {
    const fromEnv = new GlitchClient({ url: glitch.url });
    expect((await fromEnv.health()).status).toBe('ok');
  } finally {
    if (previous === undefined) delete process.env.GLITCH_TOKEN;
    else process.env.GLITCH_TOKEN = previous;
  }
});

test('leaves the proxied API itself unauthenticated', async ({ request }) => {
  // Only the control routes are ever protected. Application traffic is
  // untouched, which is what lets the browser talk to Glitch without a token.
  expect((await request.get('/users')).status()).toBe(200);
});

test('rejects a call carrying no token', async ({ glitch }) => {
  const anonymous = new GlitchClient({ url: glitch.url });
  await expect(anonymous.health()).rejects.toThrow(GlitchResponseError);
});

test('rejects a call carrying the wrong token', async ({ glitch }) => {
  const wrong = new GlitchClient({ url: glitch.url, token: 'not-the-token' });
  await expect(wrong.health()).rejects.toThrow(GlitchResponseError);
});

test('explains how to authenticate on a rejected call', async ({ glitch }) => {
  const anonymous = new GlitchClient({ url: glitch.url });
  await expect(anonymous.health()).rejects.toThrow(/GLITCH_TOKEN/);
});
