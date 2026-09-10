/** Values the integration config and the specs both need to agree on. */

/** Serves the JSON database with no chaos in its baseline. */
export const JSON_PORT = 3100;
/** Same, but with the control API behind a bearer token. */
export const AUTH_PORT = 3101;
/** Reverse proxy in front of the SSE origin, for realtime chaos. */
export const PROXY_PORT = 3102;
/** The SSE origin itself. */
export const ORIGIN_PORT = 3103;

/** Token the auth project's server is started with. */
export const CONTROL_TOKEN = 'integration-test-token';

/** Collection sized so a bandwidth cap produces a measurable delay. */
export const LARGE_COLLECTION = '/payload';
