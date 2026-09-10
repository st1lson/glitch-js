import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import type { GlitchOptions } from 'glitch-playwright';

import { AUTH_PORT, CONTROL_TOKEN, JSON_PORT, ORIGIN_PORT, PROXY_PORT } from './constants.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const FIXTURES = join(import.meta.dirname, 'fixtures');
const BIN_DIR = join(REPO_ROOT, '.glitch');

function launcher(): string {
  const fromEnv = process.env.GLITCH_BIN;
  const candidates = [...(fromEnv ? [fromEnv] : []), join(BIN_DIR, 'glitch.exe'), join(BIN_DIR, 'glitch')];

  const binary = candidates.find((candidate) => existsSync(candidate));
  if (binary) return `"${binary}"`;

  throw new Error(
    'No Glitch server binary found. Run `npm run glitch:install` to fetch one into .glitch, ' +
      'or point GLITCH_BIN at an existing build. The integration suite drives a real server ' +
      'rather than a stub, so there is nothing to fall back to.',
  );
}

const glitch = launcher();

// The JSON engine persists writes, so the suite would otherwise grow its own
// fixture on every run. Tests work against a scratch copy of the seed.
copyFileSync(join(FIXTURES, 'db.seed.json'), join(FIXTURES, 'db.json'));

export default defineConfig<GlitchOptions>({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Bandwidth and stall tests deliberately spend seconds in a single request.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'list' : 'line',

  projects: [
    {
      name: 'json',
      testIgnore: /(auth|realtime)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${JSON_PORT}`,
        glitchUrl: `http://localhost:${JSON_PORT}`,
      },
    },
    {
      name: 'auth',
      testMatch: /auth\.spec\.ts/,
      use: {
        baseURL: `http://localhost:${AUTH_PORT}`,
        glitchUrl: `http://localhost:${AUTH_PORT}`,
        glitchToken: CONTROL_TOKEN,
      },
    },
    {
      name: 'realtime',
      testMatch: /realtime\.spec\.ts/,
      use: {
        baseURL: `http://localhost:${PROXY_PORT}`,
        glitchUrl: `http://localhost:${PROXY_PORT}`,
      },
    },
  ],

  webServer: [
    {
      command: `${glitch} db.json --config glitch.yaml --port ${JSON_PORT} --no-tui`,
      // The control API is mounted ahead of the chaos middleware, so health
      // answers as soon as the server is listening.
      url: `http://localhost:${JSON_PORT}/_glitch/health`,
      cwd: FIXTURES,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 60_000,
    },
    {
      command: `${glitch} db.json --config glitch.yaml --port ${AUTH_PORT} --no-tui --control-token ${CONTROL_TOKEN}`,
      // Health needs the token here, so readiness is probed on a route that
      // does not sit behind the control API.
      url: `http://localhost:${AUTH_PORT}/users`,
      cwd: FIXTURES,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 60_000,
    },
    {
      command: `node sse-origin.mjs`,
      url: `http://localhost:${ORIGIN_PORT}/health`,
      cwd: FIXTURES,
      env: { SSE_ORIGIN_PORT: String(ORIGIN_PORT) },
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 60_000,
    },
    {
      command: `${glitch} --config glitch.yaml --port ${PROXY_PORT} --no-tui --proxy http://127.0.0.1:${ORIGIN_PORT}`,
      url: `http://localhost:${PROXY_PORT}/_glitch/health`,
      cwd: FIXTURES,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 60_000,
    },
  ],
});
