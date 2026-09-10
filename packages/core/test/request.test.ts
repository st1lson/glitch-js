import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BEARER_PREFIX, HTTP_HEADER, SCENARIO_HEADER } from '../src/constants.ts';
import { GlitchInputError } from '../src/errors.ts';
import { buildRequest, controlRoot } from '../src/request.ts';

const target = { url: 'http://localhost:3000' };

describe('controlRoot', () => {
  it('appends the control prefix to a bare origin', () => {
    assert.equal(controlRoot('http://localhost:3000'), 'http://localhost:3000/_glitch');
    assert.equal(controlRoot('http://localhost:3000/'), 'http://localhost:3000/_glitch');
  });

  it('does not double up a prefix that is already there', () => {
    assert.equal(controlRoot('http://localhost:3000/_glitch'), 'http://localhost:3000/_glitch');
    assert.equal(controlRoot('http://localhost:3000/_glitch/'), 'http://localhost:3000/_glitch');
  });

  it('rejects a URL with no scheme', () => {
    assert.throws(() => controlRoot('localhost:3000'), GlitchInputError);
    assert.throws(() => controlRoot(''), GlitchInputError);
  });
});

describe('buildRequest', () => {
  it('maps every operation onto its endpoint', () => {
    const cases: [Parameters<typeof buildRequest>[1], string, string][] = [
      [{ kind: 'health' }, 'GET', 'http://localhost:3000/_glitch/health'],
      [{ kind: 'config' }, 'GET', 'http://localhost:3000/_glitch/config'],
      [{ kind: 'baseline' }, 'GET', 'http://localhost:3000/_glitch/config/baseline'],
      [{ kind: 'merge', chaos: {} }, 'PATCH', 'http://localhost:3000/_glitch/rules'],
      [{ kind: 'reset' }, 'DELETE', 'http://localhost:3000/_glitch/rules'],
      [{ kind: 'profiles' }, 'GET', 'http://localhost:3000/_glitch/profiles'],
      [{ kind: 'applyProfile', name: '3g' }, 'POST', 'http://localhost:3000/_glitch/profile/3g'],
      [{ kind: 'resume' }, 'POST', 'http://localhost:3000/_glitch/resume'],
      [{ kind: 'report' }, 'GET', 'http://localhost:3000/_glitch/report'],
      [
        { kind: 'scenarioReport', scenario: 'checkout' },
        'GET',
        'http://localhost:3000/_glitch/scenarios/checkout/report',
      ],
    ];

    for (const [operation, method, url] of cases) {
      const request = buildRequest(target, operation);
      assert.equal(request.method, method, operation.kind);
      assert.equal(request.url, url, operation.kind);
    }
  });

  it('sends the scenario header only when a scenario is set', () => {
    assert.equal(buildRequest(target, { kind: 'health' }).headers[SCENARIO_HEADER], undefined);
    assert.equal(
      buildRequest({ ...target, scenario: 'checkout' }, { kind: 'health' }).headers[SCENARIO_HEADER],
      'checkout',
    );
  });

  it('sends a bearer token only when one is configured', () => {
    assert.equal(buildRequest(target, { kind: 'health' }).headers[HTTP_HEADER.authorization], undefined);
    assert.equal(
      buildRequest({ ...target, token: 'secret' }, { kind: 'health' }).headers[HTTP_HEADER.authorization],
      `${BEARER_PREFIX}secret`,
    );
  });

  it('sets a JSON content type only on requests that carry a body', () => {
    assert.equal(
      buildRequest(target, { kind: 'merge', chaos: {} }).headers[HTTP_HEADER.contentType],
      'application/json',
    );
    assert.equal(buildRequest(target, { kind: 'reset' }).headers[HTTP_HEADER.contentType], undefined);
  });

  it('serializes the chaos override into the merge body', () => {
    const request = buildRequest(target, { kind: 'merge', chaos: { latency: { fixed: 2000 } } });
    assert.equal(request.body, JSON.stringify({ latency: { fixed: '2000ms' } }));
  });

  it('encodes the pause timeout as a query parameter', () => {
    assert.equal(
      buildRequest(target, { kind: 'pause', timeout: 5000 }).url,
      'http://localhost:3000/_glitch/pause?timeout=5000ms',
    );
    assert.equal(buildRequest(target, { kind: 'pause' }).url, 'http://localhost:3000/_glitch/pause');
  });

  it('escapes values that would otherwise change the path', () => {
    assert.equal(
      buildRequest(target, { kind: 'applyProfile', name: 'team/mobile' }).url,
      'http://localhost:3000/_glitch/profile/team%2Fmobile',
    );
    assert.equal(
      buildRequest(target, { kind: 'scenarioReport', scenario: 'a b/c' }).url,
      'http://localhost:3000/_glitch/scenarios/a%20b%2Fc/report',
    );
  });

  it('rejects empty names', () => {
    assert.throws(() => buildRequest(target, { kind: 'applyProfile', name: '  ' }), GlitchInputError);
    assert.throws(() => buildRequest(target, { kind: 'scenarioReport', scenario: '' }), GlitchInputError);
  });
});
