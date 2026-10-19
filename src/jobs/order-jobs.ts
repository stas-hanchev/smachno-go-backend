import { publishAfterCommit } from '../lib/after-commit.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSettings } from '../lib/settings.js';
import { addMinutes } from '../lib/time.js';
import { lockOrder, recordStatus, releaseStock } from '../modules/orders/order-core.js';
import {
  listingChanged,
  notifyOrder,
  orderChanged,
  publishListingUpdate,
} from '../modules/orders/order-events.js';
import { reconcilePayments } from '../modules/payments/payments.service.js';

const BATCH = 200;
const REMINDER_LEAD_MIN = 30;
const TOKEN_RETENTION_DAYS = 7;

export async function expirePendingOrders(now = new Date()): Promise<number> {
  const due = await prisma.order.findMany({
    where: { status: 'pending_payment', reservedUntil: { lt: now } },
    select: { id: true },
    take: BATCH,
  });
  let expired = 0;
  for (const { id } of due) {
    const done = await publishAfterCommit((after) =>
      prisma.$transaction(async (tx) => {
        const order = await lockOrder(tx, id);
        if (order.status !== 'pending_payment' || order.reservedUntil >= now) return false;
        await tx.order.update({ where: { id }, data: { status: 'expired' } });
        await recordStatus(tx, id, order.status, 'expired', { type: 'system' });
        await releaseStock(tx, order.listingId, order.quantity);
        listingChanged(after, order.listingId);
        orderChanged(after, order, order.status, 'expired');
        return true;
      }),
    );
    if (done) expired += 1;
  }
  return expired;
}

export async function closeListingSales(now = new Date()): Promise<number> {
  const settings = await getSettings();
  const where = {
    status: { in: ['scheduled' as const, 'on_sale' as const, 'sold_out' as const] },
    pickupEnd: { lte: addMinutes(now, settings.sales_close_offset_min) },
  };
  const due = await prisma.offerListing.findMany({ where, select: { id: true }, take: BATCH });
  if (!due.length) return 0;
  const ids = due.map((l) => l.id);
  const result = await prisma.offerListing.updateMany({
    where: { ...where, id: { in: ids } },
    data: { status: 'closed' },
  });
  for (const id of ids) await publishListingUpdate(id);
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
    const done = await publishAfterCommit((after) =>
      prisma.$transaction(async (tx) => {
        const order = await lockOrder(tx, id);
        if (order.status !== 'paid') return false;
        await tx.order.update({
          where: { id },
          data: { status: 'no_show', voucherStatus: 'expired' },
        });
        await recordStatus(tx, id, order.status, 'no_show', { type: 'system' });
        orderChanged(after, order, order.status, 'no_show');
        return true;
      }),
    );
    if (done) marked += 1;
  }
  return marked;
}

export async function remindPickup(now = new Date()): Promise<number> {
  const due = await prisma.order.findMany({
    where: {
      status: 'paid',
      reminderSentAt: null,
      pickupStart: { gt: now, lte: addMinutes(now, REMINDER_LEAD_MIN) },
    },
    select: { id: true },
    take: BATCH,
  });
  let sent = 0;
  for (const { id } of due) {
    const claimed = await prisma.order.updateMany({
      where: { id, status: 'paid', reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (claimed.count === 0) continue;
    await notifyOrder(id, { kind: 'pickup_reminder' });
    sent += 1;
  }
  return sent;
}

export async function cleanupTokens(now = new Date()): Promise<number> {
  const cutoff = addMinutes(now, -TOKEN_RETENTION_DAYS * 24 * 60);
  const [refresh, oneTime] = await prisma.$transaction([
    prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: cutoff } }] },
    }),
    prisma.authToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
    }),
  ]);
  return refresh.count + oneTime.count;
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
  { name: 'remindPickup', everyMs: 60_000, run: () => remindPickup() },
  { name: 'reconcilePayments', everyMs: 5 * 60_000, run: () => reconcilePayments() },
  { name: 'cleanupTokens', everyMs: 6 * 3_600_000, run: () => cleanupTokens() },
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
