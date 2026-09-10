export const SCENARIO_HEADER = 'X-Glitch-Scenario';

export const CONTROL_PREFIX = '/_glitch';

export const DEFAULT_SCENARIO = 'default';

export const DEFAULT_BASE_URL = 'http://localhost:3000';

export const DEFAULT_PAUSE_TIMEOUT = '30s';

export const ENV_VAR = {
  baseUrl: 'GLITCH_URL',
  token: 'GLITCH_TOKEN',
} as const;

export const BUILTIN_PROFILES = ['mobile', '3g', 'bad-wifi', 'production'] as const;

/** Routes relative to {@link CONTROL_PREFIX}. */
export const CONTROL_PATH = {
  health: '/health',
  config: '/config',
  baseline: '/config/baseline',
  rules: '/rules',
  profiles: '/profiles',
  profile: '/profile',
  pause: '/pause',
  resume: '/resume',
  report: '/report',
  scenarios: '/scenarios',
} as const;

export const QUERY_PARAM = {
  timeout: 'timeout',
} as const;

export const HTTP_HEADER = {
  accept: 'Accept',
  contentType: 'Content-Type',
  authorization: 'Authorization',
} as const;

export const MEDIA_TYPE_JSON = 'application/json';

export const BEARER_PREFIX = 'Bearer ';

/** Status codes the SDK reacts to rather than merely reporting. */
export const HTTP_STATUS = {
  ok: 200,
  multipleChoices: 300,
  unauthorized: 401,
  notFound: 404,
} as const;

/** Bounds the server enforces, checked here so input fails at the call site. */
export const LIMITS = {
  minPercent: 0,
  maxPercent: 100,
  minStatusCode: 100,
  maxStatusCode: 599,
  /** Ids ride on every request as a header, so longer ones get hashed down. */
  scenarioIdLength: 120,
  errorBodyPreview: 400,
} as const;

export const DEFAULT_STATUS_RATE = LIMITS.maxPercent;
