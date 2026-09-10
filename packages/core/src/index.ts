/**
 * Zero-dependency client for the Glitch chaos-engineering control API.
 *
 * Test-framework integrations build on this package. Use it directly when
 * driving Glitch from a script, a custom runner, or a framework that has no
 * dedicated integration yet.
 */

export type { GlitchClientOptions, ProfileName, Transport, TransportResponse } from './client.ts';
export { fetchTransport, GlitchClient } from './client.ts';
export {
  BEARER_PREFIX,
  BUILTIN_PROFILES,
  CONTROL_PATH,
  CONTROL_PREFIX,
  DEFAULT_BASE_URL,
  DEFAULT_PAUSE_TIMEOUT,
  DEFAULT_SCENARIO,
  DEFAULT_STATUS_RATE,
  ENV_VAR,
  HTTP_HEADER,
  HTTP_STATUS,
  LIMITS,
  MEDIA_TYPE_JSON,
  QUERY_PARAM,
  SCENARIO_HEADER,
} from './constants.ts';
export { GlitchConnectionError, GlitchError, GlitchInputError, GlitchResponseError } from './errors.ts';
export type { ControlTarget, GlitchRequest, HttpMethod, Operation } from './request.ts';
export { buildRequest, controlRoot } from './request.ts';

export { sanitizeScenario, scenarioId } from './scenario.ts';

export {
  serializeBandwidth,
  serializeChaos,
  serializeCorruption,
  serializeDuration,
  serializeFailure,
  serializeLatency,
  serializeMonkey,
  serializeRealtime,
  serializeRoute,
  serializeStall,
} from './serialize.ts';

export type {
  BandwidthInput,
  BodyOperator,
  BodyPredicateInput,
  BodyPredicatePayload,
  ChaosInput,
  ChaosPayload,
  CorruptionInput,
  CorruptionPayload,
  CorruptionStrategy,
  Distribution,
  DurationInput,
  FailureInput,
  FailurePayload,
  GlitchConfig,
  HealthResponse,
  LatencyInput,
  LatencyPayload,
  MonkeyInput,
  MonkeyPayload,
  MonkeyPhaseInput,
  MonkeyPhasePayload,
  ProfilesResponse,
  RealtimeInput,
  RealtimePayload,
  ReportMetrics,
  RequestEvent,
  RouteInput,
  RoutePayload,
  ScenarioReport,
  StallInput,
  StallMode,
  StallPayload,
  StatusInput,
  StatusPayload,
  WireBodyPredicate,
  WireCorruptionConfig,
  WireFailureConfig,
  WireLatencyConfig,
  WireMonkeyConfig,
  WireMonkeyPhase,
  WireRealtimeConfig,
  WireRouteConfig,
  WireStallConfig,
  WireStatusConfig,
} from './types.ts';
