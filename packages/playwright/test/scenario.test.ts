import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TestInfo } from '@playwright/test';

import { scenarioFromTestInfo } from '../src/scenario.ts';

interface FakeTestInfo {
  file: string;
  project: { name: string };
  titlePath: string[];
  parallelIndex: number;
  repeatEachIndex: number;
}

function testInfo(overrides: Partial<FakeTestInfo> = {}): TestInfo {
  const fake: FakeTestInfo = {
    file: '/repo/tests/checkout.spec.ts',
    project: { name: 'chromium' },
    titlePath: ['chromium', '/repo/tests/checkout.spec.ts', 'checkout', 'pays with a card'],
    parallelIndex: 0,
    repeatEachIndex: 0,
    ...overrides,
  };
  return fake as unknown as TestInfo;
}

describe('scenarioFromTestInfo', () => {
  it('builds a readable id from the file, project and title', () => {
    assert.equal(scenarioFromTestInfo(testInfo()), 'checkout-spec-ts-chromium-checkout-pays-with-a-card-0');
  });

  it('does not repeat the project or file already present in the title path', () => {
    const id = scenarioFromTestInfo(testInfo());
    assert.equal(id.match(/chromium/g)?.length, 1);
    assert.equal(id.match(/checkout-spec-ts/g)?.length, 1);
  });

  it('separates the same test running in different workers', () => {
    assert.notEqual(
      scenarioFromTestInfo(testInfo({ parallelIndex: 0 })),
      scenarioFromTestInfo(testInfo({ parallelIndex: 1 })),
    );
  });

  it('separates projects so a cross-browser matrix does not collide', () => {
    assert.notEqual(
      scenarioFromTestInfo(testInfo({ project: { name: 'chromium' } })),
      scenarioFromTestInfo(testInfo({ project: { name: 'firefox' } })),
    );
  });

  it('separates repeats but not retries', () => {
    // repeatEachIndex is part of the id, so each repeat gets its own scenario.
    assert.notEqual(
      scenarioFromTestInfo(testInfo({ repeatEachIndex: 0 })),
      scenarioFromTestInfo(testInfo({ repeatEachIndex: 1 })),
    );

    // retry is not consulted at all, so a retry reuses the same rules.
    assert.equal(scenarioFromTestInfo(testInfo()), scenarioFromTestInfo(testInfo()));
  });

  it('copes with a title path that carries neither project nor file', () => {
    assert.equal(
      scenarioFromTestInfo(testInfo({ titlePath: ['pays with a card'] })),
      'checkout-spec-ts-chromium-pays-with-a-card-0',
    );
  });

  it('stays within a sane header length for very long titles', () => {
    const id = scenarioFromTestInfo(testInfo({ titlePath: ['a'.repeat(500)] }));
    assert.ok(id.length <= 120, `id was ${id.length} characters`);
  });
});
