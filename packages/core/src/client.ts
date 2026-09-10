/**
 * Promise-based client for the Glitch control API.
 *
 * It owns no HTTP code: `buildRequest` describes each call and a replaceable
 * transport executes it. The Playwright integration uses that seam to route
 * control traffic through Playwright, which puts it in the trace.
 */
import {
  type BUILTIN_PROFILES,
  DEFAULT_BASE_URL,
  DEFAULT_PAUSE_TIMEOUT,
  DEFAULT_SCENARIO,
  DEFAULT_STATUS_RATE,
  ENV_VAR,
  HTTP_STATUS,
  LIMITS,
} from './constants.ts';
import { GlitchConnectionError, GlitchInputError, GlitchResponseError } from './errors.ts';
import { buildRequest, type ControlTarget, type GlitchRequest, type Operation } from './request.ts';
import type {
  BandwidthInput,
  ChaosInput,
  CorruptionInput,
  CorruptionStrategy,
  DurationInput,
  GlitchConfig,
  HealthResponse,
  LatencyInput,
  MonkeyInput,
  ProfilesResponse,
  RealtimeInput,
  RouteInput,
  ScenarioReport,
  StallInput,
} from './types.ts';

/** Minimal response shape a transport must produce. */
export interface TransportResponse {
  status: number;
  body: string;
}

/** Executes a control API request. Replaceable so control calls can be traced. */
export type Transport = (request: GlitchRequest) => Promise<TransportResponse>;

/**
 * Declared structurally rather than as `typeof fetch`, so the published types
 * do not force consumers to pull in DOM or Node lib definitions.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Built-in chaos profiles, offered as completions without closing the type. */
export type ProfileName = (typeof BUILTIN_PROFILES)[number] | (string & {});

export interface GlitchClientOptions {
  url?: string | undefined;
  token?: string | undefined;
  scenario?: string | undefined;
  transport?: Transport | undefined;
  pauseTimeout?: DurationInput | undefined;
}

function env(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.[name];
  return value === undefined || value === '' ? undefined : value;
}

export function fetchTransport(fetchImpl?: FetchLike): Transport {
  return async (request) => {
    const impl = fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (typeof impl !== 'function') {
      throw new GlitchInputError(
        'No fetch implementation is available. Run on Node 18 or newer, or pass a custom "transport".',
      );
    }

    let response: { status: number; text(): Promise<string> };
    try {
      response = await impl(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
      });
    } catch (cause) {
      throw new GlitchConnectionError(request.url, cause);
    }

    return { status: response.status, body: await response.text() };
  };
}

/**
 * Talks to one Glitch server, optionally scoped to one scenario.
 *
 * Every chaos method merges onto whatever the scenario already has, mirroring
 * the server's own overlay semantics. See {@link GlitchClient.set} for the
 * replace-instead-of-merge variant, and {@link GlitchClient.reset} for the only
 * way to switch a rule back off.
 */
export class GlitchClient {
  readonly #target: ControlTarget;
  readonly #transport: Transport;
  readonly #pauseTimeout: DurationInput;

  constructor(options: GlitchClientOptions = {}) {
    this.#target = {
      url: options.url ?? env(ENV_VAR.baseUrl) ?? DEFAULT_BASE_URL,
      token: options.token ?? env(ENV_VAR.token),
      scenario: options.scenario,
    };
    this.#transport = options.transport ?? fetchTransport();
    this.#pauseTimeout = options.pauseTimeout ?? DEFAULT_PAUSE_TIMEOUT;
  }

  get url(): string {
    return this.#target.url;
  }

  get scenario(): string | undefined {
    return this.#target.scenario;
  }

  /** Returns a client pointed at a different scenario, sharing this transport. */
  withScenario(scenario: string | undefined): GlitchClient {
    return new GlitchClient({
      url: this.#target.url,
      token: this.#target.token,
      scenario,
      transport: this.#transport,
      pauseTimeout: this.#pauseTimeout,
    });
  }

  health(): Promise<HealthResponse> {
    return this.#json({ kind: 'health' });
  }

  config(): Promise<GlitchConfig> {
    return this.#json({ kind: 'config' });
  }

  /** The configuration Glitch started with, before any overlay. */
  baseline(): Promise<GlitchConfig> {
    return this.#json({ kind: 'baseline' });
  }

  /**
   * Overlays chaos rules onto this scenario and returns the resulting config.
   *
   * The server merges additively: a rule can be raised or replaced, but not
   * cleared. Setting a rate to 0 does not switch that chaos off. Use
   * {@link GlitchClient.reset} or {@link GlitchClient.set} for that.
   */
  merge(chaos: ChaosInput): Promise<GlitchConfig> {
    return this.#json({ kind: 'merge', chaos });
  }

  /** Clears the scenario back to baseline, then applies the given rules. */
  async set(chaos: ChaosInput): Promise<GlitchConfig> {
    await this.reset();
    return this.merge(chaos);
  }

  /** Drops every overlay, returning the scenario to the baseline config. */
  async reset(): Promise<void> {
    await this.#send({ kind: 'reset' });
  }

  profiles(): Promise<ProfilesResponse> {
    return this.#json({ kind: 'profiles' });
  }

  /** Resets the scenario, then applies a named profile such as `3g`. */
  async profile(name: ProfileName): Promise<void> {
    await this.#send({ kind: 'applyProfile', name });
  }

  /**
   * Holds every request for this scenario until resumed. Control calls are
   * unaffected, so the resume always gets through. Prefer
   * {@link GlitchClient.paused}, which cannot leak a paused scenario.
   */
  async pause(options: { timeout?: DurationInput | undefined } = {}): Promise<void> {
    await this.#send({ kind: 'pause', timeout: options.timeout ?? this.#pauseTimeout });
  }

  async resume(): Promise<void> {
    await this.#send({ kind: 'resume' });
  }

  /**
   * Pauses, runs the callback, then resumes even if it throws. The request
   * stays in flight for as long as the callback runs, which is what makes a
   * loading-state assertion deterministic.
   */
  async paused<T>(
    fn: () => Promise<T> | T,
    options: { timeout?: DurationInput | undefined } = {},
  ): Promise<T> {
    await this.pause(options);
    try {
      return await fn();
    } finally {
      await this.resume();
    }
  }

  async report(): Promise<ScenarioReport[]> {
    const reports = await this.#json<ScenarioReport[] | null>({ kind: 'report' });
    return reports ?? [];
  }

  /**
   * Glitch only tracks a scenario once rules have been overlaid onto it.
   * Traffic tagged with an unknown scenario is recorded under `default`.
   */
  scenarioReport(scenario: string | undefined = this.#target.scenario): Promise<ScenarioReport> {
    return this.#json({ kind: 'scenarioReport', scenario: scenario ?? DEFAULT_SCENARIO });
  }

  /* -------------------------------------------------------------- *
   * Chaos shorthands. Each one merges; none of them clear other rules.
   * -------------------------------------------------------------- */

  /**
   * Makes matching responses fail with a specific status code.
   *
   * Status rates are rolled before the overall failure rate, so a rate of 100
   * makes the code deterministic regardless of the baseline config.
   */
  fail(code: number, rate: number = DEFAULT_STATUS_RATE): Promise<GlitchConfig> {
    return this.merge({ failure: { statuses: [{ code, rate }] } });
  }

  /** Fails the given percentage of requests with a 500. */
  failRate(rate: number): Promise<GlitchConfig> {
    return this.merge({ failure: { rate } });
  }

  latency(value: DurationInput | LatencyInput): Promise<GlitchConfig> {
    const latency: LatencyInput =
      typeof value === 'string' || typeof value === 'number' ? { fixed: value } : value;
    return this.merge({ latency });
  }

  throttle(bandwidth: BandwidthInput): Promise<GlitchConfig> {
    return this.merge({ bandwidth });
  }

  corrupt(rate: number, options: Omit<CorruptionInput, 'rate'> = {}): Promise<GlitchConfig> {
    return this.merge({ corruption: { rate, ...options } });
  }

  corruptWith(rate: number, strategies: CorruptionStrategy[], multi = false): Promise<GlitchConfig> {
    return this.merge({ corruption: { rate, strategies, multi } });
  }

  stall(options: StallInput): Promise<GlitchConfig> {
    return this.merge({ stall: options });
  }

  realtime(options: RealtimeInput): Promise<GlitchConfig> {
    return this.merge({ realtime: options });
  }

  /** Replaces this scenario's route overrides. Routes are not merged per-route. */
  routes(routes: RouteInput[]): Promise<GlitchConfig> {
    return this.merge({ routes });
  }

  /**
   * Cycles chaos settings on a timer.
   *
   * Chaos monkey is a server-wide loop, not a per-scenario one: it reads and
   * writes the default scenario's config regardless of which scenario enabled
   * it. Setting it from a scoped client stores the config but changes nothing,
   * and setting it on the default scenario affects every test on the server.
   * Configure it in glitch.yaml or on the command line instead, unless the run
   * is deliberately serial.
   */
  monkey(options: MonkeyInput): Promise<GlitchConfig> {
    return this.merge({ monkey: { enabled: true, ...options } });
  }

  /* -------------------------------------------------------------- */

  /** Discards the acknowledgement the server sends back. */
  async #send(operation: Operation): Promise<void> {
    await this.#call(operation);
  }

  async #json<T>(operation: Operation): Promise<T> {
    const { request, response } = await this.#call(operation);

    if (response.body.trim() === '') {
      throw this.#malformed(request, response, 'expected a JSON body, received an empty response');
    }

    try {
      return JSON.parse(response.body) as T;
    } catch {
      throw this.#malformed(
        request,
        response,
        `expected JSON, received ${response.body.slice(0, LIMITS.errorBodyPreview)}`,
      );
    }
  }

  async #call(operation: Operation): Promise<{ request: GlitchRequest; response: TransportResponse }> {
    const request = buildRequest(this.#target, operation);
    const response = await this.#transport(request);

    if (response.status < HTTP_STATUS.ok || response.status >= HTTP_STATUS.multipleChoices) {
      throw new GlitchResponseError({
        status: response.status,
        url: request.url,
        method: request.method,
        body: response.body,
      });
    }

    return { request, response };
  }

  #malformed(request: GlitchRequest, response: TransportResponse, detail: string): GlitchResponseError {
    return new GlitchResponseError({
      status: response.status,
      url: request.url,
      method: request.method,
      body: detail,
    });
  }
}
