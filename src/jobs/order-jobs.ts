import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSettings } from '../lib/settings.js';
import { addMinutes } from '../lib/time.js';
import { lockOrder, recordStatus, releaseStock } from '../modules/orders/order-core.js';

const BATCH = 200;

export async function expirePendingOrders(now = new Date()): Promise<number> {
  const due = await prisma.order.findMany({
    where: { status: 'pending_payment', reservedUntil: { lt: now } },
    select: { id: true },
    take: BATCH,
  });
  let expired = 0;
  for (const { id } of due) {
    const done = await prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== 'pending_payment' || order.reservedUntil >= now) return false;
      await tx.order.update({ where: { id }, data: { status: 'expired' } });
      await recordStatus(tx, id, order.status, 'expired', { type: 'system' });
      await releaseStock(tx, order.listingId, order.quantity);
      return true;
    });
    if (done) expired += 1;
  }
  return expired;
}

export async function closeListingSales(now = new Date()): Promise<number> {
  const settings = await getSettings();
  const result = await prisma.offerListing.updateMany({
    where: {
      status: { in: ['scheduled', 'on_sale', 'sold_out'] },
      pickupEnd: { lte: addMinutes(now, settings.sales_close_offset_min) },
    },
    data: { status: 'closed' },
  });
  return result.count;
}

export async function markNoShow(now = new Date()): Promise<number> {
  const due = await prisma.order.findMany({
    where: { status: 'paid', voucherValidUntil: { lt: now } },
    select: { id: true },
    take: BATCH,
  });
  let marked = 0;
  for (const { id } of due) {
    const done = await prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== 'paid') return false;
      await tx.order.update({
        where: { id },
        data: { status: 'no_show', voucherStatus: 'expired' },
      });
      await recordStatus(tx, id, order.status, 'no_show', { type: 'system' });
      return true;
    });
    if (done) marked += 1;
  }
  return marked;
}

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<number>;
}

const JOBS: Job[] = [
  { name: 'expirePendingOrders', everyMs: 60_000, run: () => expirePendingOrders() },
  { name: 'closeListingSales', everyMs: 60_000, run: () => closeListingSales() },
  { name: 'markNoShow', everyMs: 5 * 60_000, run: () => markNoShow() },
];

export function startInProcessJobs(): () => void {
  const timers = JOBS.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const count = await job.run();
        if (count > 0) logger.info({ job: job.name, count }, 'Job processed records');
      } catch (err) {
        logger.error({ err, job: job.name }, 'Job failed');
      } finally {
        running = false;
      }
    };
    void tick();
    return setInterval(tick, job.everyMs);
  });
  return () => timers.forEach(clearInterval);
}
