import { createApp } from './app.js';
import { env } from './config/env.js';
import { startInProcessJobs } from './jobs/order-jobs.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { attachRealtime } from './realtime/socket.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'SmachnoGo API is listening');
});
const io = attachRealtime(server);

const stopJobs = env.RUN_JOBS_IN_PROCESS ? startInProcessJobs() : () => undefined;

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  stopJobs();
  void io.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
