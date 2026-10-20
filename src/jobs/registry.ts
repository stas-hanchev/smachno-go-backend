import { jobDuration, jobRuns } from '../lib/metrics.js';
import { logger } from '../lib/logger.js';
import { captureError } from '../lib/sentry.js';
import { reconcilePayments } from '../modules/payments/payments.service.js';
import { recomputeRecommendations } from '../modules/recommendations/recommendations.service.js';
import {
  cleanupTokens,
  closeListingSales,
  expirePendingOrders,
  markNoShow,
  remindPickup,
} from './order-jobs.js';

export interface JobDefinition {
  name: string;
  everyMs: number;
  run: () => Promise<number>;
}

export const JOBS: JobDefinition[] = [
  { name: 'expirePendingOrders', everyMs: 60_000, run: () => expirePendingOrders() },
  { name: 'closeListingSales', everyMs: 60_000, run: () => closeListingSales() },
  { name: 'markNoShow', everyMs: 5 * 60_000, run: () => markNoShow() },
  { name: 'remindPickup', everyMs: 60_000, run: () => remindPickup() },
  { name: 'reconcilePayments', everyMs: 5 * 60_000, run: () => reconcilePayments() },
  { name: 'recomputeRecommendations', everyMs: 3_600_000, run: () => recomputeRecommendations() },
  { name: 'cleanupTokens', everyMs: 6 * 3_600_000, run: () => cleanupTokens() },
];

export async function runJob(job: JobDefinition): Promise<number> {
  const stopTimer = jobDuration.startTimer({ job: job.name });
  try {
    const count = await job.run();
    jobRuns.inc({ job: job.name, result: 'ok' });
    if (count > 0) logger.info({ job: job.name, count }, 'Job processed records');
    return count;
  } catch (err) {
    jobRuns.inc({ job: job.name, result: 'error' });
    logger.error({ err, job: job.name }, 'Job failed');
    captureError(err, { job: job.name });
    throw err;
  } finally {
    stopTimer();
  }
}

export function startInProcessJobs(): () => void {
  const timers = JOBS.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await runJob(job);
      } catch {
      } finally {
        running = false;
      }
    };
    void tick();
    return setInterval(tick, job.everyMs);
  });
  return () => timers.forEach(clearInterval);
}
