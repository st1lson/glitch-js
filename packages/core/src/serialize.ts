/**
 * Translates the camelCase input types test authors write into the exact
 * snake_case JSON the Go control API unmarshals.
 *
 * Everything here is pure and synchronous so both the promise-based client and
 * command-queue integrations such as Cypress can share it.
 */
import { DEFAULT_STATUS_RATE, LIMITS } from './constants.ts';
import { GlitchInputError } from './errors.ts';
import type {
  BandwidthInput,
  BodyPredicateInput,
  BodyPredicatePayload,
  ChaosInput,
  ChaosPayload,
  CorruptionInput,
  CorruptionPayload,
  DurationInput,
  FailureInput,
  FailurePayload,
  LatencyInput,
  LatencyPayload,
  MonkeyInput,
  MonkeyPayload,
  MonkeyPhaseInput,
  MonkeyPhasePayload,
  RealtimeInput,
  RealtimePayload,
  RouteInput,
  RoutePayload,
  StallInput,
  StallPayload,
} from './types.ts';

/**
 * Go's time.ParseDuration grammar: one or more decimal numbers, each with a
 * unit suffix. Validating here turns a typo into a thrown error at the call
 * site instead of an opaque 400 from the server.
 */
const DURATION_PATTERN =
  /^[-+]?(\d+(\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)((\d+(\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h))*$/;

const BANDWIDTH_PATTERN = /^\s*(\d+(\.\d*)?|\.\d+)\s*(kbps|kb\/s|mbps|mb\/s|bps|b\/s)?\s*$/i;

const UNLIMITED_BANDWIDTH = 'unlimited';

/** Numbers are milliseconds, so `2000` becomes `"2000ms"`. */
export function serializeDuration(value: DurationInput, field = 'duration'): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new GlitchInputError(
        `${field} must be a finite number of milliseconds, received ${String(value)}`,
      );
    }
    if (value < 0) {
      throw new GlitchInputError(`${field} must not be negative, received ${value}`);
    }
    return `${value}ms`;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    throw new GlitchInputError(`${field} must not be an empty string`);
  }
  if (trimmed === '0') return '0s';
  if (!DURATION_PATTERN.test(trimmed)) {
    throw new GlitchInputError(
      `${field} is not a valid duration: ${JSON.stringify(value)}. Use a number of milliseconds, or a string such as "250ms", "2s" or "1m30s".`,
    );
  }
  return trimmed;
}

/** Numbers are bytes per second and pass straight through. */
export function serializeBandwidth(value: BandwidthInput, field = 'bandwidth'): string | number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new GlitchInputError(
        `${field} must be a non-negative number of bytes per second, received ${String(value)}`,
      );
    }
    return Math.round(value);
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    throw new GlitchInputError(`${field} must not be an empty string`);
  }
  if (trimmed.toLowerCase() === UNLIMITED_BANDWIDTH || trimmed === '0') return trimmed.toLowerCase();
  if (!BANDWIDTH_PATTERN.test(trimmed)) {
    throw new GlitchInputError(
      `${field} is not a valid bandwidth: ${JSON.stringify(value)}. Use a number of bytes per second, or a string such as "50kbps", "1mbps" or "5kb/s".`,
    );
  }
  return trimmed;
}

function percent(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new GlitchInputError(`${field} must be a finite number, received ${String(value)}`);
  }
  if (value < LIMITS.minPercent || value > LIMITS.maxPercent) {
    throw new GlitchInputError(
      `${field} must be a percentage between ${LIMITS.minPercent} and ${LIMITS.maxPercent}, received ${value}`,
    );
  }
  return value;
}

function statusCode(value: number): number {
  if (!Number.isInteger(value) || value < LIMITS.minStatusCode || value > LIMITS.maxStatusCode) {
    throw new GlitchInputError(
      `status code must be an integer between ${LIMITS.minStatusCode} and ${LIMITS.maxStatusCode}, received ${String(value)}`,
    );
  }
  return value;
}

/** Drops keys whose value is undefined, or returns undefined if none remain. */
function compact<T extends object>(source: T): T | undefined {
  const entries = Object.entries(source).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/** Applies a serializer only when the caller supplied a value. */
function optional<In, Out>(value: In | undefined, serializer: (value: In) => Out): Out | undefined {
  return value === undefined ? undefined : serializer(value);
}

export function serializeLatency(input: LatencyInput, path = 'latency'): LatencyPayload | undefined {
  if (input.min !== undefined && input.max === undefined) {
    throw new GlitchInputError(`${path}.min was set without ${path}.max; random latency needs both bounds`);
  }
  if (input.max !== undefined && input.min === undefined) {
    throw new GlitchInputError(`${path}.max was set without ${path}.min; random latency needs both bounds`);
  }

  return compact<LatencyPayload>({
    fixed: optional(input.fixed, (v) => serializeDuration(v, `${path}.fixed`)),
    min: optional(input.min, (v) => serializeDuration(v, `${path}.min`)),
    max: optional(input.max, (v) => serializeDuration(v, `${path}.max`)),
    distribution: input.distribution,
  });
}

export function serializeFailure(input: FailureInput, path = 'failure'): FailurePayload | undefined {
  return compact<FailurePayload>({
    rate: optional(input.rate, (v) => percent(v, `${path}.rate`)),
    statuses: input.statuses?.map((status) => ({
      code: statusCode(status.code),
      rate: status.rate === undefined ? DEFAULT_STATUS_RATE : percent(status.rate, `${path}.statuses[].rate`),
    })),
  });
}

export function serializeStall(input: StallInput, path = 'stall'): StallPayload | undefined {
  return compact<StallPayload>({
    rate: optional(input.rate, (v) => percent(v, `${path}.rate`)),
    mode: input.mode,
    drop_at: optional(input.dropAt, (v) => percent(v, `${path}.dropAt`)),
  });
}

export function serializeCorruption(
  input: CorruptionInput,
  path = 'corruption',
): CorruptionPayload | undefined {
  return compact<CorruptionPayload>({
    rate: optional(input.rate, (v) => percent(v, `${path}.rate`)),
    strategies: input.strategies,
    multi: input.multi,
  });
}

export function serializeRealtime(input: RealtimeInput, path = 'realtime'): RealtimePayload | undefined {
  return compact<RealtimePayload>({
    latency: optional(input.latency, (v) => serializeLatency(v, `${path}.latency`)),
    drop_rate: optional(input.dropRate, (v) => percent(v, `${path}.dropRate`)),
    disconnect_rate: optional(input.disconnectRate, (v) => percent(v, `${path}.disconnectRate`)),
    out_of_order: input.outOfOrder,
    max_buffered_messages: input.maxBufferedMessages,
  });
}

function serializeBodyPredicate(input: BodyPredicateInput, path: string): BodyPredicatePayload {
  if (!input.field) {
    throw new GlitchInputError(`${path}.field is required on a body predicate`);
  }

  return {
    field: input.field,
    ...(input.op === undefined ? {} : { op: input.op }),
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}

export function serializeRoute(input: RouteInput, path = 'route'): RoutePayload {
  // The server requires every matcher present to hold, so a route carrying
  // none would match every request.
  const matchers = [input.path, input.operationId, input.method, input.headers, input.query, input.body];
  if (matchers.every((matcher) => matcher === undefined)) {
    throw new GlitchInputError(
      `${path} has nothing to match on. Give it a path, operationId, method, headers, query or body predicate.`,
    );
  }

  return (
    compact<RoutePayload>({
      path: input.path,
      method: input.method?.toUpperCase(),
      operation_id: input.operationId,
      headers: input.headers,
      query: input.query,
      body: input.body?.map((predicate, index) =>
        serializeBodyPredicate(predicate, `${path}.body[${index}]`),
      ),
      bandwidth: optional(input.bandwidth, (v) => serializeBandwidth(v, `${path}.bandwidth`)),
      latency: optional(input.latency, (v) => serializeLatency(v, `${path}.latency`)),
      failure: optional(input.failure, (v) => serializeFailure(v, `${path}.failure`)),
      stall: optional(input.stall, (v) => serializeStall(v, `${path}.stall`)),
      corruption: optional(input.corruption, (v) => serializeCorruption(v, `${path}.corruption`)),
      realtime: optional(input.realtime, (v) => serializeRealtime(v, `${path}.realtime`)),
    }) ?? {}
  );
}

function serializeMonkeyPhase(input: MonkeyPhaseInput, path: string): MonkeyPhasePayload {
  return {
    duration: serializeDuration(input.duration, `${path}.duration`),
    ...compact<Omit<MonkeyPhasePayload, 'duration'>>({
      bandwidth: optional(input.bandwidth, (v) => serializeBandwidth(v, `${path}.bandwidth`)),
      latency: optional(input.latency, (v) => serializeLatency(v, `${path}.latency`)),
      failure: optional(input.failure, (v) => serializeFailure(v, `${path}.failure`)),
      stall: optional(input.stall, (v) => serializeStall(v, `${path}.stall`)),
      corruption: optional(input.corruption, (v) => serializeCorruption(v, `${path}.corruption`)),
      realtime: optional(input.realtime, (v) => serializeRealtime(v, `${path}.realtime`)),
    }),
  };
}

export function serializeMonkey(input: MonkeyInput, path = 'monkey'): MonkeyPayload | undefined {
  return compact<MonkeyPayload>({
    enabled: input.enabled,
    phases: input.phases?.map((phase, index) => serializeMonkeyPhase(phase, `${path}.phases[${index}]`)),
  });
}

/**
 * Builds the body for `PATCH /_glitch/rules`. An input carrying nothing yields
 * an empty object, which the server accepts as a no-op.
 */
export function serializeChaos(input: ChaosInput): ChaosPayload {
  return (
    compact<ChaosPayload>({
      bandwidth: optional(input.bandwidth, (v) => serializeBandwidth(v)),
      latency: optional(input.latency, (v) => serializeLatency(v)),
      failure: optional(input.failure, (v) => serializeFailure(v)),
      stall: optional(input.stall, (v) => serializeStall(v)),
      corruption: optional(input.corruption, (v) => serializeCorruption(v)),
      monkey: optional(input.monkey, (v) => serializeMonkey(v)),
      realtime: optional(input.realtime, (v) => serializeRealtime(v)),
      routes: input.routes?.map((route, index) => serializeRoute(route, `routes[${index}]`)),
    }) ?? {}
  );
}
