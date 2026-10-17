import type { Prisma } from '../../generated/prisma/client.js';
import { notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  issueVoucher,
  lockOrder,
  recordStatus,
  refundOrderPayment,
  reserveStock,
} from '../orders/order-core.js';

export interface PaymentResult {
  providerOrderId: string;
  status: 'success' | 'failure';
  providerPaymentId?: string | null;
  method?: string | null;
  raw?: Prisma.InputJsonValue;
}

export type PaymentOutcome = 'paid' | 'already_processed' | 'failed' | 'refunded_late_payment';

export async function processPaymentResult(result: PaymentResult): Promise<PaymentOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM payments WHERE provider_order_id = ${result.providerOrderId} FOR UPDATE`;
    if (!row) throw notFound('Платіж не знайдено');
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: row.id } });

    if (payment.status === 'success' || payment.status === 'reversed') {
      return { outcome: 'already_processed' as const, orderId: payment.orderId };
    }

    if (result.status === 'failure') {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failure',
          method: result.method ?? null,
          ...(result.raw !== undefined && { rawCallback: result.raw }),
        },
      });
      return { outcome: 'failed' as const, orderId: payment.orderId };
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'success',
        paidAt: new Date(),
        providerPaymentId: result.providerPaymentId ?? null,
        method: result.method ?? null,
        ...(result.raw !== undefined && { rawCallback: result.raw }),
      },
    });

    const order = await lockOrder(tx, payment.orderId);
    const actor = { type: 'payment_provider' as const };

    if (order.status === 'pending_payment') {
      await tx.order.update({ where: { id: order.id }, data: { status: 'paid' } });
      await recordStatus(tx, order.id, order.status, 'paid', actor);
      await issueVoucher(tx, order);
      return { outcome: 'paid' as const, orderId: order.id };
    }

    if (order.status === 'expired' && (await reserveStock(tx, order.listingId, order.quantity))) {
      await tx.order.update({ where: { id: order.id }, data: { status: 'paid' } });
      await recordStatus(
        tx,
        order.id,
        order.status,
        'paid',
        actor,
        'Late payment, stock reserved again',
      );
      await issueVoucher(tx, order);
      return { outcome: 'paid' as const, orderId: order.id };
    }

    if (order.status === 'expired') {
      await tx.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
      await recordStatus(
        tx,
        order.id,
        order.status,
        'refunded',
        { type: 'system' },
        'Late payment, sold out',
      );
    }
    return { outcome: 'refunded_late_payment' as const, orderId: order.id, paymentId: payment.id };
  });

  if (outcome.outcome === 'refunded_late_payment') {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: outcome.paymentId } });
    await refundOrderPayment(
      outcome.orderId,
      payment.amount,
      'Оплата надійшла після завершення резерву',
      {
        type: 'system',
      },
      outcome.paymentId,
    );
  }
  logger.info(
    { providerOrderId: result.providerOrderId, outcome: outcome.outcome },
    'Payment result processed',
  );
  return outcome.outcome;
}
