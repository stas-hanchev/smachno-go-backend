import type {
  ActorType,
  Order,
  OrderStatus,
  RefundInitiator,
} from '../../generated/prisma/client.js';
import { voucherCode } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import type { Decimal } from '../../lib/money.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { addMinutes } from '../../lib/time.js';
import { getGateway } from '../payments/provider.js';
import { buildVoucherToken, voucherTokenHash } from './voucher.js';

export interface Actor {
  type: ActorType;
  id?: bigint | null;
}

export async function recordStatus(
  tx: Tx,
  orderId: bigint,
  from: OrderStatus | null,
  to: OrderStatus,
  actor: Actor,
  note?: string,
): Promise<void> {
  await tx.orderStatusHistory.create({
    data: {
      orderId,
      fromStatus: from,
      toStatus: to,
      actorType: actor.type,
      actorId: actor.id ?? null,
      note: note?.slice(0, 255) ?? null,
    },
  });
}

export async function reserveStock(tx: Tx, listingId: bigint, quantity: number): Promise<boolean> {
  const settings = await getSettings();
  const salesOpenUntil = addMinutes(new Date(), settings.sales_close_offset_min);
  const affected = await tx.$executeRaw`
    UPDATE offer_listings
    SET status = IF(quantity_left = ${quantity}, 'sold_out', status),
        quantity_left = quantity_left - ${quantity}
    WHERE id = ${listingId}
      AND status = 'on_sale'
      AND quantity_left >= ${quantity}
      AND pickup_end > ${salesOpenUntil}`;
  return affected === 1;
}

export async function releaseStock(tx: Tx, listingId: bigint, quantity: number): Promise<void> {
  const settings = await getSettings();
  const salesOpenUntil = addMinutes(new Date(), settings.sales_close_offset_min);
  await tx.$executeRaw`
    UPDATE offer_listings
    SET status = IF(status = 'sold_out' AND pickup_end > ${salesOpenUntil}, 'on_sale', status),
        quantity_left = LEAST(quantity_total, quantity_left + ${quantity})
    WHERE id = ${listingId}`;
}

export async function lockOrder(tx: Tx, orderId: bigint): Promise<Order> {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
  return tx.order.findUniqueOrThrow({ where: { id: orderId } });
}

export async function issueVoucher(tx: Tx, order: Order): Promise<void> {
  const settings = await getSettings();
  const validUntil = addMinutes(order.pickupEnd, settings.grace_period_min);
  const token = buildVoucherToken(order.publicId, order.venueId, validUntil);

  let code = voucherCode();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const taken = await tx.order.count({
      where: { venueId: order.venueId, pickupDate: order.pickupDate, voucherCode: code },
    });
    if (!taken) break;
    code = voucherCode();
  }

  await tx.order.update({
    where: { id: order.id },
    data: {
      voucherCode: code,
      voucherTokenHash: voucherTokenHash(token),
      voucherStatus: 'active',
      voucherValidUntil: validUntil,
    },
  });
}

export async function refundOrderPayment(
  orderId: bigint,
  amount: Decimal,
  reason: string,
  initiator: { type: RefundInitiator; id?: bigint | null },
  paymentId?: bigint,
): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, status: 'success', ...(paymentId ? { id: paymentId } : {}) },
    orderBy: { id: 'desc' },
  });
  if (!payment) return;

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      amount,
      reason: reason.slice(0, 255),
      initiatedBy: initiator.type,
      initiatorId: initiator.id ?? null,
    },
  });
  try {
    const result = await getGateway().refund(payment.providerOrderId, amount);
    await prisma.$transaction([
      prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: result.success ? 'success' : 'failure',
          providerResponse: result.response as object,
          completedAt: new Date(),
        },
      }),
      ...(result.success
        ? [prisma.payment.update({ where: { id: payment.id }, data: { status: 'reversed' } })]
        : []),
    ]);
  } catch (err) {
    logger.error({ err, orderId: orderId.toString() }, 'Refund request failed');
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: 'failure', providerResponse: { error: String(err) } },
    });
  }
}
