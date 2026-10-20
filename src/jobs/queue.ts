import { Queue, Worker } from 'bullmq';
import { logger } from '../lib/logger.js';
import { createRedis } from '../lib/redis.js';
import { JOBS, runJob } from './registry.js';

export const JOBS_QUEUE = 'smachnogo-jobs';

export async function startQueueWorker(): Promise<() => Promise<void>> {
  const queue = new Queue(JOBS_QUEUE, { connection: createRedis('queue') });
  for (const job of JOBS) {
    await queue.upsertJobScheduler(
      job.name,
      { every: job.everyMs },
      { name: job.name, opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
  }

  const byName = new Map(JOBS.map((job) => [job.name, job]));
  const worker = new Worker(
    JOBS_QUEUE,
    async (task) => {
      const job = byName.get(task.name);
      if (!job) {
        logger.warn({ job: task.name }, 'Unknown job skipped');
        return 0;
      }
      return runJob(job);
    },
    { connection: createRedis('worker'), concurrency: 1 },
  );
  worker.on('error', (err) => logger.error({ err }, 'Queue worker error'));
  logger.info({ jobs: JOBS.map((j) => j.name) }, 'Job schedulers registered');

  return async () => {
    await worker.close();
    await queue.close();
  };
}
