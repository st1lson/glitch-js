/**
 * `Wire*` and `*Payload` types mirror the Go structs in `internal/config`,
 * snake_case tags included. The `*Input` types are the camelCase surface test
 * authors write; `serializeChaos` translates one into the other.
 */

/** A percentage from 0 to 100 inclusive. */
export type Percentage = number;

/** Ignored unless both bounds of a latency range are set. */
export type Distribution = 'normal' | 'uniform';

export type CorruptionStrategy = 'drop_field' | 'swap_type' | 'inject_null' | 'break_syntax';

/** `drop` resets the connection, `hang` blocks indefinitely. */
export type StallMode = 'drop' | 'hang';

export type BodyOperator = 'eq' | 'neq' | 'contains' | 'exists' | 'prefix';

/**
 * A Go-style duration string (`"250ms"`, `"2s"`, `"1m30s"`) or a number of
 * milliseconds. `2000` and `"2s"` are equivalent.
 */
export type DurationInput = string | number;

/**
 * A suffixed string (`"50kbps"`, `"1mbps"`, `"5kb/s"`) or a raw number of bytes
 * per second.
 */
export type BandwidthInput = string | number;

/** Delays the response. `min` and `max` must be given together. */
export interface LatencyInput {
  fixed?: DurationInput;
  min?: DurationInput;
  max?: DurationInput;
  distribution?: Distribution;
}

export interface StatusInput {
  code: number;
  /** Defaults to 100, making the code deterministic. */
  rate?: Percentage;
}

/**
 * Returns errors instead of the real response.
 *
 * Per-status rates are rolled before the overall rate, which yields a 500.
 */
export interface FailureInput {
  rate?: Percentage;
  statuses?: StatusInput[];
}

/** Cuts a response off part-way through streaming it. */
export interface StallInput {
  rate?: Percentage;
  mode?: StallMode;
  /** How much of the payload to stream before stalling. */
  dropAt?: Percentage;
}

/** Mutates JSON response bodies to exercise schema resilience. */
export interface CorruptionInput {
  rate?: Percentage;
  /** Omit to draw from every mutator. */
  strategies?: CorruptionStrategy[];
  /** Apply several mutators to one response instead of exactly one. */
  multi?: boolean;
}

/** Chaos applied to WebSocket and Server-Sent Events streams. */
export interface RealtimeInput {
  /** Delay applied to individual messages, not to the request. */
  latency?: LatencyInput;
  dropRate?: Percentage;
  disconnectRate?: Percentage;
  outOfOrder?: boolean;
  /** Buffer depth used for out-of-order delivery. Defaults to 100. */
  maxBufferedMessages?: number;
}

export interface BodyPredicateInput {
  /** Dot-separated path into the request body. */
  field: string;
  /** Defaults to `eq`. */
  op?: BodyOperator;
  /** Unused by `exists`. */
  value?: string;
}

/**
 * Overrides chaos for requests matching every predicate present.
 *
 * A route needs at least one matcher. Path patterns support a trailing
 * wildcard, and the most specific matching route wins.
 */
export interface RouteInput {
  path?: string;
  method?: string;
  /** Matches an OpenAPI operation id, when Glitch is serving a spec. */
  operationId?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: BodyPredicateInput[];

  bandwidth?: BandwidthInput;
  latency?: LatencyInput;
  failure?: FailureInput;
  stall?: StallInput;
  corruption?: CorruptionInput;
  realtime?: RealtimeInput;
}

export interface MonkeyPhaseInput {
  duration: DurationInput;
  bandwidth?: BandwidthInput;
  latency?: LatencyInput;
  failure?: FailureInput;
  stall?: StallInput;
  corruption?: CorruptionInput;
  realtime?: RealtimeInput;
}

/** Cycles through chaos phases on a timer. */
export interface MonkeyInput {
  enabled?: boolean;
  phases?: MonkeyPhaseInput[];
}

/**
 * Chaos settings that can be overlaid onto a scenario.
 *
 * Server settings such as port and auth token are absent because the control
 * API ignores them on `PATCH /_glitch/rules`.
 */
export interface ChaosInput {
  bandwidth?: BandwidthInput;
  latency?: LatencyInput;
  failure?: FailureInput;
  stall?: StallInput;
  corruption?: CorruptionInput;
  monkey?: MonkeyInput;
  realtime?: RealtimeInput;
  /** Replaces the scenario's route list wholesale. Not merged per-route. */
  routes?: RouteInput[];
}

/* ------------------------------------------------------------------ *
 * Wire types: exactly what the server returns.
 * ------------------------------------------------------------------ */

export interface WireLatencyConfig {
  fixed: string;
  min: string;
  max: string;
  distribution: Distribution | '';
}

export interface WireStatusConfig {
  code: number;
  rate: Percentage;
}

export interface WireFailureConfig {
  rate: Percentage;
  statuses: WireStatusConfig[] | null;
}

export interface WireStallConfig {
  rate: Percentage;
  mode: StallMode | '';
  drop_at: Percentage;
}

export interface WireCorruptionConfig {
  rate: Percentage;
  strategies: CorruptionStrategy[] | null;
  multi: boolean;
}

export interface WireRealtimeConfig {
  latency: WireLatencyConfig;
  drop_rate: Percentage;
  disconnect_rate: Percentage;
  out_of_order: boolean;
  max_buffered_messages: number;
}

export interface WireBodyPredicate {
  field: string;
  op?: BodyOperator;
  value?: string;
}

export interface WireRouteConfig {
  path?: string;
  method?: string;
  operation_id?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: WireBodyPredicate[];
  bandwidth?: string | number;
  latency?: WireLatencyConfig;
  failure?: WireFailureConfig;
  stall?: WireStallConfig;
  corruption?: WireCorruptionConfig;
  realtime?: WireRealtimeConfig;
}

export interface WireMonkeyPhase {
  duration: string;
  bandwidth: string | number;
  latency: WireLatencyConfig;
  failure: WireFailureConfig;
  stall: WireStallConfig;
  corruption: WireCorruptionConfig;
  realtime: WireRealtimeConfig;
}

export interface WireMonkeyConfig {
  enabled: boolean;
  phases: WireMonkeyPhase[] | null;
}

/** The full server configuration, as returned by the config endpoints. */
export interface GlitchConfig {
  port: number;
  host: string;
  file: string;
  proxy: string;
  verbose: boolean;
  read_only: boolean;
  no_tui: boolean;
  control_token: string;
  insecure_control_api: boolean;
  seed?: number;
  report_path?: string;
  report_format?: string;
  bandwidth: string | number;
  latency: WireLatencyConfig;
  failure: WireFailureConfig;
  stall: WireStallConfig;
  corruption: WireCorruptionConfig;
  monkey: WireMonkeyConfig;
  realtime: WireRealtimeConfig;
  routes: WireRouteConfig[] | null;
}

export interface HealthResponse {
  status: string;
  paused: boolean;
  scenario: string;
}

export interface ProfilesResponse {
  builtin: string[];
  custom: string[] | null;
}

export interface RequestEvent {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  chaos_latency_ms?: number;
  chaos_failure_code?: number;
  chaos_corrupted?: boolean;
  chaos_stalled?: boolean;
}

export interface ReportMetrics {
  requests: number;
  failures: number;
  stalls: number;
  total_latency_added_ms: number;
  corrupted_payloads: number;
  total_bytes_written: number;
  total_duration_ms: number;
}

/** Everything Glitch recorded for one scenario. */
export interface ScenarioReport {
  scenario: string;
  seed: number | null;
  effective_config: GlitchConfig;
  metrics: ReportMetrics;
  request_events: RequestEvent[] | null;
  status: string;
}

/* ------------------------------------------------------------------ *
 * Payload types: what the SDK sends to PATCH /_glitch/rules.
 *
 * Distinct from the Wire types because a request omits anything it does not
 * set, while a response always carries every field.
 * ------------------------------------------------------------------ */

export interface LatencyPayload {
  fixed?: string;
  min?: string;
  max?: string;
  distribution?: Distribution;
}

export interface StatusPayload {
  code: number;
  rate: Percentage;
}

export interface FailurePayload {
  rate?: Percentage;
  statuses?: StatusPayload[];
}

export interface StallPayload {
  rate?: Percentage;
  mode?: StallMode;
  drop_at?: Percentage;
}

export interface CorruptionPayload {
  rate?: Percentage;
  strategies?: CorruptionStrategy[];
  multi?: boolean;
}

export interface RealtimePayload {
  latency?: LatencyPayload;
  drop_rate?: Percentage;
  disconnect_rate?: Percentage;
  out_of_order?: boolean;
  max_buffered_messages?: number;
}

export interface BodyPredicatePayload {
  field: string;
  op?: BodyOperator;
  value?: string;
}

export interface RoutePayload {
  path?: string;
  method?: string;
  operation_id?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: BodyPredicatePayload[];
  bandwidth?: string | number;
  latency?: LatencyPayload;
  failure?: FailurePayload;
  stall?: StallPayload;
  corruption?: CorruptionPayload;
  realtime?: RealtimePayload;
}

export interface MonkeyPhasePayload {
  duration: string;
  bandwidth?: string | number;
  latency?: LatencyPayload;
  failure?: FailurePayload;
  stall?: StallPayload;
  corruption?: CorruptionPayload;
  realtime?: RealtimePayload;
}

export interface MonkeyPayload {
  enabled?: boolean;
  phases?: MonkeyPhasePayload[];
}

/** Body of a `PATCH /_glitch/rules` call. */
export interface ChaosPayload {
  bandwidth?: string | number;
  latency?: LatencyPayload;
  failure?: FailurePayload;
  stall?: StallPayload;
  corruption?: CorruptionPayload;
  monkey?: MonkeyPayload;
  realtime?: RealtimePayload;
  routes?: RoutePayload[];
}
