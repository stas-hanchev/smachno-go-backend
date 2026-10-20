import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { httpRequestDuration, metricsRegistry } from './lib/metrics.js';
import { prisma } from './lib/prisma.js';
import { pingRedis, redisEnabled } from './lib/redis.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalRateLimit } from './middleware/rate-limit.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { authRouter, CSRF_HEADER } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { favoritesRouter } from './modules/favorites/favorites.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { partnerRouter } from './modules/partner/partner.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { recommendationsRouter } from './modules/recommendations/recommendations.routes.js';
import { meRouter } from './modules/users/me.routes.js';
import { generateOpenApi, type RouterMount } from './openapi/generate.js';

const API_BASE = '/api/v1';

const MOUNTS: RouterMount[] = [
  { path: '/auth', router: authRouter, tag: 'auth' },
  { path: '/me', router: notificationsRouter, tag: 'me' },
  { path: '/me', router: meRouter, tag: 'me' },
  { path: '/favorites', router: favoritesRouter, tag: 'favorites' },
  { path: '/orders', router: ordersRouter, tag: 'orders' },
  { path: '/payments', router: paymentsRouter, tag: 'payments' },
  { path: '/partner', router: partnerRouter, tag: 'partner' },
  { path: '/admin', router: adminRouter, tag: 'admin' },
  { path: '/', router: recommendationsRouter, tag: 'recommendations' },
  { path: '/', router: catalogRouter, tag: 'catalog' },
];

let openApiCache: unknown = null;

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use((req, res, next) => {
    const stopTimer = httpRequestDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path
        ? `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}`
        : 'unmatched';
      stopTimer({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', CSRF_HEADER],
      exposedHeaders: ['x-request-id', 'Retry-After'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3_000).unref()),
      ]);
    } catch {
      res.status(503).json({ status: 'not_ready', mysql: 'error' });
      return;
    }
    const redisOk = await pingRedis();
    const redis = redisEnabled ? (redisOk ? 'ok' : 'error') : 'disabled';
    res.status(redisOk ? 200 : 503).json({
      status: redisOk ? 'ready' : 'not_ready',
      mysql: 'ok',
      redis,
    });
  });
  app.get('/metrics', async (req, res) => {
    if (!env.METRICS_TOKEN || req.get('authorization') !== `Bearer ${env.METRICS_TOKEN}`) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  });
  app.get(`${API_BASE}/openapi.json`, (_req, res) => {
    openApiCache ??= generateOpenApi(MOUNTS, API_BASE, process.env.npm_package_version ?? '0.1.0');
    res.json(openApiCache);
  });

  const api = express.Router();
  api.use(globalRateLimit);
  for (const mount of MOUNTS) api.use(mount.path, mount.router as express.Router);

  app.use(API_BASE, api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
