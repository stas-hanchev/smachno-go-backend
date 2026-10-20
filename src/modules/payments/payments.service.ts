import { env } from '../../config/env.js';
import type { Payment, Prisma } from '../../generated/prisma/client.js';
import { publishAfterCommit } from '../../lib/after-commit.js';
import { notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { paymentResults } from '../../lib/metrics.js';
import { Decimal } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { addMinutes } from '../../lib/time.js';
import { listingChanged, notifyOrderAfterCommit, orderChanged } from '../orders/order-events.js';
import {
  issueVoucher,
  lockOrder,
  recordPurchase,
  recordStatus,
  refundOrderPayment,
  reserveStock,
} from '../orders/order-core.js';
import { decodeLiqpayData, verifyLiqpaySignature } from './liqpay.js';
import { getGateway, liqpayStatusFromPayload, type ProviderStatus } from './provider.js';

export interface PaymentResult {
  providerOrderId: string;
  status: 'success' | 'failure';
  providerPaymentId?: string | null;
  method?: string | null;
  raw?: Prisma.InputJsonValue;
}

export type PaymentOutcome = 'paid' | 'already_processed' | 'failed' | 'refunded_late_payment';

export async function processPaymentResult(result: PaymentResult): Promise<PaymentOutcome> {
  return publishAfterCommit(async (after) => {
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
        await recordPurchase(tx, order);
        orderChanged(after, order, order.status, 'paid');
        notifyOrderAfterCommit(after, order.id, { kind: 'paid' });
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
        await recordPurchase(tx, order);
        orderChanged(after, order, order.status, 'paid');
        listingChanged(after, order.listingId);
        notifyOrderAfterCommit(after, order.id, { kind: 'paid' });
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
        orderChanged(after, order, order.status, 'refunded');
      }
      notifyOrderAfterCommit(after, order.id, { kind: 'late_payment_refunded' });
      return {
        outcome: 'refunded_late_payment' as const,
        orderId: order.id,
        paymentId: payment.id,
      };
    });

    if (outcome.outcome === 'refunded_late_payment') {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: outcome.paymentId } });
      await refundOrderPayment(
        outcome.orderId,
        payment.amount,
        'Оплата надійшла після завершення резерву',
        { type: 'system' },
        outcome.paymentId,
      );
    }
    paymentResults.inc({ provider: env.PAYMENT_PROVIDER, outcome: outcome.outcome });
    logger.info(
      { providerOrderId: result.providerOrderId, outcome: outcome.outcome },
      'Payment result processed',
    );
    return outcome.outcome;
  });
}

export type ProviderStatusOutcome = PaymentOutcome | 'pending' | 'reversed' | 'amount_mismatch';

function amountMatches(payment: Payment, status: ProviderStatus): boolean {
  if (status.amount === null || status.currency !== 'UAH') return false;
  try {
    return new Decimal(status.amount).equals(payment.amount);
  } catch {
    return false;
  }
}

export async function applyProviderStatus(
  providerOrderId: string,
  status: ProviderStatus,
): Promise<ProviderStatusOutcome> {
  const payment = await prisma.payment.findUnique({ where: { providerOrderId } });
  if (!payment) throw notFound('Платіж не знайдено');
  const raw = status.raw as Prisma.InputJsonObject;

  if (status.state === 'success' || status.state === 'failure') {
    if (status.state === 'success' && !amountMatches(payment, status)) {
      logger.error(
        { providerOrderId, amount: status.amount, currency: status.currency },
        'Payment amount does not match the order',
      );
      return 'amount_mismatch';
    }
    return processPaymentResult({
      providerOrderId,
      status: status.state,
      providerPaymentId: status.providerPaymentId,
      method: status.method,
      raw,
    });
  }

  if (status.state === 'reversed') {
    if (payment.status === 'success') {
      await prisma.$transaction([
        prisma.payment.update({ where: { id: payment.id }, data: { status: 'reversed' } }),
        prisma.refund.updateMany({
          where: { paymentId: payment.id, status: { in: ['pending', 'failure'] } },
          data: { status: 'success', completedAt: new Date() },
        }),
      ]);
    }
    return 'reversed';
  }

  if (payment.status === 'created') {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: 'created' },
      data: { status: 'processing', rawCallback: raw },
    });
  }
  return 'pending';
}

export interface CallbackResult {
  httpStatus: number;
  outcome?: ProviderStatusOutcome;
}

export async function handleLiqpayCallback(
  data: unknown,
  signature: unknown,
): Promise<CallbackResult> {
  const dataStr = typeof data === 'string' ? data : '';
  const signatureStr = typeof signature === 'string' ? signature : '';
  const signatureValid =
    dataStr.length > 0 &&
    signatureStr.length > 0 &&
    verifyLiqpaySignature(dataStr, signatureStr, env.LIQPAY_PRIVATE_KEY);
  const payload = dataStr ? decodeLiqpayData(dataStr) : null;

  const log = await prisma.paymentWebhookLog.create({
    data: {
      provider: 'liqpay',
      signatureValid,
      payload: (payload ?? { raw: dataStr.slice(0, 2000) }) as Prisma.InputJsonObject,
    },
  });
  const finish = (processed: boolean, error?: string) =>
    prisma.paymentWebhookLog.update({
      where: { id: log.id },
      data: { processed, error: error?.slice(0, 500) ?? null },
    });

  if (!signatureValid || !payload) {
    await finish(false, signatureValid ? 'Malformed data' : 'Invalid signature');
    return { httpStatus: 400 };
  }
  if (payload.public_key !== undefined && payload.public_key !== env.LIQPAY_PUBLIC_KEY) {
    await finish(false, 'Unknown public key');
    return { httpStatus: 400 };
  }
  const providerOrderId = typeof payload.order_id === 'string' ? payload.order_id : null;
  if (!providerOrderId) {
    await finish(false, 'No order_id');
    return { httpStatus: 400 };
  }

  if (!(await prisma.payment.count({ where: { providerOrderId } }))) {
    await finish(false, 'Unknown order_id');
    return { httpStatus: 200 };
  }

  try {
    const outcome = await applyProviderStatus(
      providerOrderId,
      liqpayStatusFromPayload(payload, env.LIQPAY_SANDBOX),
    );
    await finish(
      outcome !== 'amount_mismatch',
      outcome === 'amount_mismatch' ? outcome : undefined,
    );
    return { httpStatus: 200, outcome };
  } catch (err) {
    await finish(false, String(err));
    throw err;
  }
}

export async function syncPaymentStatus(
  providerOrderId: string,
): Promise<ProviderStatusOutcome | null> {
  const status = await getGateway().getStatus(providerOrderId);
  if (!status) return null;
  return applyProviderStatus(providerOrderId, status);
}

const RECONCILE_AFTER_MIN = 3;
const RECONCILE_WINDOW_HOURS = 24;

export async function reconcilePayments(now = new Date()): Promise<number> {
  if (getGateway().name === 'fake') return 0;
  const payments = await prisma.payment.findMany({
    where: {
      provider: 'liqpay',
      status: { in: ['created', 'processing'] },
      createdAt: {
        lt: addMinutes(now, -RECONCILE_AFTER_MIN),
        gt: addMinutes(now, -RECONCILE_WINDOW_HOURS * 60),
      },
    },
    select: { providerOrderId: true },
    orderBy: { id: 'asc' },
    take: 50,
  });
  let changed = 0;
  for (const { providerOrderId } of payments) {
    try {
      const outcome = await syncPaymentStatus(providerOrderId);
      if (outcome && outcome !== 'pending') changed += 1;
    } catch (err) {
      logger.warn({ err, providerOrderId }, 'Payment status check failed');
    }
  }
  return changed;
}
