import * as Sentry from '@sentry/node';
import { env } from '../config/env.js';

export const sentryEnabled = Boolean(env.SENTRY_DSN) && env.NODE_ENV !== 'test';

export function initSentry(service: 'api' | 'worker'): void {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
    serverName: service,
    tracesSampleRate: 0,
  });
  Sentry.setTag('service', service);
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext('details', context);
    Sentry.captureException(err);
  });
}

export async function flushSentry(): Promise<void> {
  if (sentryEnabled) await Sentry.flush(2_000);
}
