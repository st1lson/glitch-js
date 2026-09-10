/** Literals this integration attaches to Playwright's own reporting surfaces. */

/** Name of the Glitch report attached to a failed test. */
export const REPORT_ATTACHMENT = 'glitch-report.json';

/** Annotation type used when teardown could not finish cleanly. */
export const TEARDOWN_ANNOTATION = 'glitch-teardown';

/** Default option values, applied when neither the config nor a test sets one. */
export const FIXTURE_DEFAULTS = {
  injectHeader: true,
  reset: true,
  attachReport: true,
  transport: 'playwright',
} as const;
