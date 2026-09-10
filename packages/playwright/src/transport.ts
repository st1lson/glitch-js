import type { APIRequestContext } from '@playwright/test';
import { GlitchConnectionError, type Transport } from 'glitch-core';

export function apiRequestTransport(request: APIRequestContext): Transport {
  return async (call) => {
    try {
      const response = await request.fetch(call.url, {
        method: call.method,
        headers: call.headers,
        ...(call.body === undefined ? {} : { data: call.body }),
        failOnStatusCode: false,
      });

      return { status: response.status(), body: await response.text() };
    } catch (cause) {
      throw new GlitchConnectionError(call.url, cause);
    }
  };
}
