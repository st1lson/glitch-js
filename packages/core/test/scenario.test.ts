import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanitizeScenario, scenarioId } from '../src/scenario.ts';

describe('sanitizeScenario', () => {
  it('reduces a test title to a header-safe slug', () => {
    assert.equal(sanitizeScenario('Shows error toast on 500'), 'shows-error-toast-on-500');
    assert.equal(sanitizeScenario('checkout > pays with card'), 'checkout-pays-with-card');
  });

  it('trims separators from both ends', () => {
    assert.equal(sanitizeScenario('  --hello--  '), 'hello');
  });

  it('still produces an id when nothing survives sanitizing', () => {
    const id = sanitizeScenario('日本語');
    assert.match(id, /^scenario-[a-z0-9]+$/);
  });

  it('truncates long titles but keeps distinct ones distinct', () => {
    const long = 'a'.repeat(400);
    const other = `${'a'.repeat(399)}b`;

    assert.ok(sanitizeScenario(long).length <= 120);
    assert.notEqual(sanitizeScenario(long), sanitizeScenario(other));
  });

  it('is stable across calls, so retries reuse the same scenario', () => {
    assert.equal(sanitizeScenario('flaky test'), sanitizeScenario('flaky test'));
  });
});

describe('scenarioId', () => {
  it('joins the parts identifying a test', () => {
    assert.equal(scenarioId(['checkout.spec.ts', 'pays with card', 3]), 'checkout-spec-ts-pays-with-card-3');
  });

  it('drops parts that carry no information', () => {
    assert.equal(scenarioId(['spec', undefined, '', null, 'name']), 'spec-name');
  });

  it('separates parallel workers running the same title', () => {
    assert.notEqual(scenarioId(['spec', 'title', 0]), scenarioId(['spec', 'title', 1]));
  });
});
