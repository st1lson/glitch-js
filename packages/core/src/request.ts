/**
 * Pure request construction for every control API operation.
 *
 * Nothing in this module performs I/O. That is deliberate: the promise-based
 * client consumes these descriptors, and so can integrations that must stay
 * inside a synchronous command queue, such as Cypress calling cy.request.
 */
import {
  BEARER_PREFIX,
  CONTROL_PATH,
  CONTROL_PREFIX,
  ENV_VAR,
  HTTP_HEADER,
  MEDIA_TYPE_JSON,
  QUERY_PARAM,
  SCENARIO_HEADER,
} from './constants.ts';
import { GlitchInputError } from './errors.ts';
import { serializeChaos, serializeDuration } from './serialize.ts';
import type { ChaosInput, DurationInput } from './types.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Where the control API lives, and who is talking to it. */
export interface ControlTarget {
  url: string;
  /** Required unless Glitch is on loopback with no token configured. */
  token?: string | undefined;
  /** Omit to target the default scenario. */
  scenario?: string | undefined;
}

export interface GlitchRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  /** Already stringified. Absent on requests that carry none. */
  body?: string;
}

export type Operation =
  | { kind: 'health' }
  | { kind: 'config' }
  | { kind: 'baseline' }
  | { kind: 'merge'; chaos: ChaosInput }
  | { kind: 'reset' }
  | { kind: 'profiles' }
  | { kind: 'applyProfile'; name: string }
  | { kind: 'pause'; timeout?: DurationInput | undefined }
  | { kind: 'resume' }
  | { kind: 'report' }
  | { kind: 'scenarioReport'; scenario: string };

/**
 * Normalizes a base URL into the control API root. Accepts a bare origin or one
 * that already ends in the control prefix, with or without a trailing slash.
 */
export function controlRoot(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '') {
    throw new GlitchInputError(
      `A Glitch base URL is required. Pass the "url" option or set ${ENV_VAR.baseUrl}.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new GlitchInputError(
      `Invalid Glitch base URL: ${JSON.stringify(url)}. Include the scheme, for example http://localhost:3000.`,
    );
  }

  // "localhost:3000" parses as a URL with the protocol "localhost:", so the
  // scheme has to be checked explicitly to catch a missing http prefix.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new GlitchInputError(
      `Glitch base URL must use http or https: ${JSON.stringify(url)}. For example http://localhost:3000.`,
    );
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  const base = path.endsWith(CONTROL_PREFIX) ? path : `${path}${CONTROL_PREFIX}`;
  return `${parsed.origin}${base}`;
}

function headersFor(target: ControlTarget, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { [HTTP_HEADER.accept]: MEDIA_TYPE_JSON };

  if (hasBody) headers[HTTP_HEADER.contentType] = MEDIA_TYPE_JSON;
  if (target.token) headers[HTTP_HEADER.authorization] = `${BEARER_PREFIX}${target.token}`;
  if (target.scenario) headers[SCENARIO_HEADER] = target.scenario;

  return headers;
}

function required(value: string, what: string): string {
  if (!value.trim()) {
    throw new GlitchInputError(`A ${what} is required.`);
  }
  return value;
}

export function buildRequest(target: ControlTarget, operation: Operation): GlitchRequest {
  const root = controlRoot(target.url);

  const get = (path: string): GlitchRequest => ({
    method: 'GET',
    url: `${root}${path}`,
    headers: headersFor(target, false),
  });

  const post = (path: string): GlitchRequest => ({
    method: 'POST',
    url: `${root}${path}`,
    headers: headersFor(target, false),
  });

  switch (operation.kind) {
    case 'health':
      return get(CONTROL_PATH.health);

    case 'config':
      return get(CONTROL_PATH.config);

    case 'baseline':
      return get(CONTROL_PATH.baseline);

    case 'profiles':
      return get(CONTROL_PATH.profiles);

    case 'report':
      return get(CONTROL_PATH.report);

    case 'resume':
      return post(CONTROL_PATH.resume);

    case 'merge':
      return {
        method: 'PATCH',
        url: `${root}${CONTROL_PATH.rules}`,
        headers: headersFor(target, true),
        body: JSON.stringify(serializeChaos(operation.chaos)),
      };

    case 'reset':
      return {
        method: 'DELETE',
        url: `${root}${CONTROL_PATH.rules}`,
        headers: headersFor(target, false),
      };

    case 'applyProfile': {
      const name = required(operation.name, 'profile name');
      return post(`${CONTROL_PATH.profile}/${encodeURIComponent(name)}`);
    }

    case 'pause': {
      const query =
        operation.timeout === undefined
          ? ''
          : `?${QUERY_PARAM.timeout}=${encodeURIComponent(serializeDuration(operation.timeout, 'pause timeout'))}`;

      return post(`${CONTROL_PATH.pause}${query}`);
    }

    case 'scenarioReport': {
      const scenario = required(operation.scenario, 'scenario id');
      return get(`${CONTROL_PATH.scenarios}/${encodeURIComponent(scenario)}${CONTROL_PATH.report}`);
    }
  }
}
