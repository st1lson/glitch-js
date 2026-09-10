import { ENV_VAR, HTTP_STATUS, LIMITS } from './constants.ts';

/** Base class for every error this package throws. */
export class GlitchError extends Error {
  override readonly name: string = 'GlitchError';
}

/** Bad input, caught before any network call is made. */
export class GlitchInputError extends GlitchError {
  override readonly name = 'GlitchInputError';
}

/** The control API was reached but answered with a non-2xx status. */
export class GlitchResponseError extends GlitchError {
  override readonly name = 'GlitchResponseError';

  readonly status: number;
  readonly url: string;
  readonly method: string;
  /** Truncated for readability. */
  readonly body: string;

  constructor(init: { status: number; url: string; method: string; body: string }) {
    super(GlitchResponseError.describe(init));
    this.status = init.status;
    this.url = init.url;
    this.method = init.method;
    this.body = init.body;
  }

  private static describe(init: { status: number; url: string; method: string; body: string }): string {
    const detail = parseErrorField(init.body) ?? truncate(init.body, LIMITS.errorBodyPreview);
    const base = `Glitch control API returned ${init.status} for ${init.method} ${init.url}`;
    const message = detail ? `${base}: ${detail}` : base;

    if (init.status === HTTP_STATUS.unauthorized) {
      return `${message}\nThe control API rejected the request. Pass a token via the "token" option or the ${ENV_VAR.token} environment variable, or start Glitch with --insecure-control-api.`;
    }
    return message;
  }
}

/** The control API could not be reached at all. */
export class GlitchConnectionError extends GlitchError {
  override readonly name = 'GlitchConnectionError';

  readonly url: string;

  constructor(url: string, cause: unknown) {
    super(
      `Could not reach the Glitch control API at ${url}. Is Glitch running, and is the URL correct? Set ${ENV_VAR.baseUrl} to override it.`,
      { cause },
    );
    this.url = url;
  }
}

function parseErrorField(body: string): string | undefined {
  if (!body.trimStart().startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const value = (parsed as { error: unknown }).error;
      if (typeof value === 'string') return value;
    }
  } catch {
    // Fall through to the raw body.
  }
  return undefined;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}
