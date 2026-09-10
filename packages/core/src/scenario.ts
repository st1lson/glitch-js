/**
 * Scenario ids ride on an HTTP header, so they stay short and free of anything
 * needing encoding. They must also be stable across retries and distinct
 * between parallel workers, or two tests end up sharing chaos rules.
 */

import { LIMITS } from './constants.ts';

/**
 * Reduces text to a header-safe slug. Over-long results are truncated and given
 * a hash suffix, so distinct inputs stay distinct.
 */
export function sanitizeScenario(raw: string, maxLength: number = LIMITS.scenarioIdLength): string {
  const slug = raw
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (slug === '') return `scenario-${hash(raw)}`;
  if (slug.length <= maxLength) return slug;

  const suffix = `-${hash(raw)}`;
  return `${slug.slice(0, maxLength - suffix.length).replace(/-+$/, '')}${suffix}`;
}

/** Joins the parts identifying a test, dropping empty and undefined ones. */
export function scenarioId(
  parts: readonly (string | number | undefined | null)[],
  maxLength: number = LIMITS.scenarioIdLength,
): string {
  const joined = parts
    .filter((part): part is string | number => part !== undefined && part !== null && String(part) !== '')
    .join('-');
  return sanitizeScenario(joined, maxLength);
}

/** FNV-1a, rendered as base36. Short, stable, and dependency-free. */
function hash(value: string): string {
  let acc = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    acc ^= value.charCodeAt(i);
    acc = Math.imul(acc, 0x01000193) >>> 0;
  }
  return acc.toString(36);
}
