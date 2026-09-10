import { basename } from 'node:path';
import type { TestInfo } from '@playwright/test';
import { scenarioId } from 'glitch-core';

/**
 * Derives a scenario id that survives retries and stays distinct across
 * parallel workers. `retry` is deliberately left out so a retry keeps the rules
 * it was written against; `repeatEachIndex` is not, since each repeat is an
 * independent run.
 */
export function scenarioFromTestInfo(testInfo: TestInfo): string {
  const project = testInfo.project.name;
  const file = testInfo.file ? basename(testInfo.file) : undefined;

  const titles = testInfo.titlePath.filter(
    (title) => title !== '' && title !== project && title !== testInfo.file && title !== file,
  );

  return scenarioId([
    file,
    project === '' ? undefined : project,
    ...titles,
    testInfo.parallelIndex,
    testInfo.repeatEachIndex === 0 ? undefined : testInfo.repeatEachIndex,
  ]);
}
