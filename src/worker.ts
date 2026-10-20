import { env } from './config/env.js';
import { startQueueWorker } from './jobs/queue.js';
import { startInProcessJobs } from './jobs/registry.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeRedis, redisEnabled } from './lib/redis.js';
import { flushSentry, initSentry } from './lib/sentry.js';
import { attachRedisEmitter } from './realtime/emitter.js';

initSentry('worker');

async function main() {
  if (!redisEnabled) {
    logger.warn('REDIS_URL is not set: running jobs on timers without a queue');
    const stop = startInProcessJobs();
    return async () => stop();
  }
  attachRedisEmitter();
  return startQueueWorker();
}

const stop = await main();
logger.info({ env: env.NODE_ENV }, 'SmachnoGo worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down');
  setTimeout(() => process.exit(1), 15_000).unref();
  await stop();
  await Promise.allSettled([prisma.$disconnect(), closeRedis(), flushSentry()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
