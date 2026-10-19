import { ulid } from 'ulid';
import type { OrderSource } from '../../generated/prisma/client.js';
import { publishAfterCommit } from '../../lib/after-commit.js';
import { AppError, businessRule, notFound } from '../../lib/errors.js';
import { toMoney, type Decimal } from '../../lib/money.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { addMinutes } from '../../lib/time.js';
import { getGateway, type CheckoutParams } from '../payments/provider.js';
import { customerOrderInclude, toCustomerOrderDto } from './order.dto.js';
import { listingChanged, notifyOrderAfterCommit, orderChanged } from './order-events.js';
import {
  lockOrder,
  recordStatus,
  refundOrderPayment,
  releaseStock,
  reserveStock,
} from './order-core.js';
import { buildVoucherToken } from './voucher.js';

const ACTIVE_STATUSES = ['pending_payment', 'paid'] as const;

async function createPaymentAttempt(
  tx: Tx,
  order: { id: bigint; publicId: string; totalAmount: Decimal; reservedUntil: Date },
  title: string,
): Promise<CheckoutParams> {
  const gateway = getGateway();
  const attempt = (await tx.payment.count({ where: { orderId: order.id } })) + 1;
  const providerOrderId = `${order.publicId}-${attempt}`;
  await tx.payment.create({
    data: { orderId: order.id, provider: gateway.name, providerOrderId, amount: order.totalAmount },
  });
  return gateway.createCheckout({
    providerOrderId,
    amount: order.totalAmount,
    description: `СмачноGo: ${title}`,
    expiresAt: order.reservedUntil,
  });
}

async function loadCustomerOrder(userId: bigint, publicId: string) {
  const order = await prisma.order.findUnique({
    where: { publicId },
    include: customerOrderInclude,
  });
  if (!order || order.userId !== userId) throw notFound('Замовлення не знайдено');
  return order;
}

export async function createOrder(
  userId: bigint,
  input: { listingId: number; quantity: number; source?: OrderSource },
  idempotencyKey?: string,
) {
  if (idempotencyKey) {
    const existing = await prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: customerOrderInclude,
    });
    if (existing) {
      const payment =
        existing.status === 'pending_payment'
          ? await prisma.$transaction((tx) =>
              createPaymentAttempt(tx, existing, existing.listing.offer.title),
            )
          : null;
      return { order: toCustomerOrderDto(existing), payment, replayed: true };
    }
  }

  const listingId = BigInt(input.listingId);
  const listing = await prisma.offerListing.findUnique({
    where: { id: listingId },
    include: {
      offer: { select: { title: true, maxPerOrder: true, status: true } },
      venue: { select: { status: true, deletedAt: true, commissionRate: true } },
    },
  });
  if (!listing || listing.venue.status !== 'active' || listing.venue.deletedAt) {
    throw notFound('Набір не знайдено');
  }
  if (input.quantity > listing.offer.maxPerOrder) {
    throw businessRule(
      `В одному замовленні можна взяти не більше ${listing.offer.maxPerOrder} шт.`,
      [{ field: 'quantity', message: `Максимум ${listing.offer.maxPerOrder}` }],
    );
  }

  const settings = await getSettings();
  const unitPrice = listing.price;
  const totalAmount = toMoney(unitPrice.times(input.quantity));
  const savingAmount = toMoney(listing.originalPrice.minus(unitPrice).times(input.quantity));
  const commissionAmount = toMoney(totalAmount.times(listing.venue.commissionRate));

  const result = await publishAfterCommit((after) =>
    prisma.$transaction(async (tx) => {
      if (!(await reserveStock(tx, listingId, input.quantity))) {
        throw new AppError('LISTING_UNAVAILABLE');
      }
      const order = await tx.order.create({
        data: {
          publicId: ulid(),
          userId,
          listingId,
          venueId: listing.venueId,
          quantity: input.quantity,
          unitPrice,
          unitOriginalPrice: listing.originalPrice,
          totalAmount,
          savingAmount,
          commissionAmount,
          status: 'pending_payment',
          reservedUntil: addMinutes(new Date(), settings.reservation_ttl_min),
          pickupDate: listing.pickupDate,
          pickupStart: listing.pickupStart,
          pickupEnd: listing.pickupEnd,
          source: input.source ?? null,
          idempotencyKey: idempotencyKey ?? null,
        },
        include: customerOrderInclude,
      });
      await recordStatus(tx, order.id, null, 'pending_payment', { type: 'customer', id: userId });
      await tx.interaction.create({
        data: { userId, offerId: listing.offerId, venueId: listing.venueId, type: 'reserve' },
      });
      const payment = await createPaymentAttempt(tx, order, listing.offer.title);
      listingChanged(after, listingId);
      orderChanged(after, order, null, 'pending_payment');
      return { order, payment };
    }),
  );

  return { order: toCustomerOrderDto(result.order), payment: result.payment, replayed: false };
}

export async function listOrders(userId: bigint, scope: 'active' | 'history') {
  const orders = await prisma.order.findMany({
    where: {
      userId,
      status: scope === 'active' ? { in: [...ACTIVE_STATUSES] } : { notIn: [...ACTIVE_STATUSES] },
    },
    include: customerOrderInclude,
    orderBy: scope === 'active' ? { pickupStart: 'asc' } : { createdAt: 'desc' },
    take: 100,
  });
  return orders.map(toCustomerOrderDto);
}

export async function getOrder(userId: bigint, publicId: string) {
  const order = await loadCustomerOrder(userId, publicId);
  const history = await prisma.orderStatusHistory.findMany({
    where: { orderId: order.id },
    orderBy: { id: 'asc' },
  });
  return {
    ...toCustomerOrderDto(order),
    statusHistory: history.map((h) => ({
      from: h.fromStatus,
      to: h.toStatus,
      at: h.createdAt.toISOString(),
    })),
    voucher: order.status === 'paid' && order.voucherStatus === 'active' ? voucherOf(order) : null,
  };
}

function voucherOf(order: {
  publicId: string;
  venueId: bigint;
  voucherCode: string | null;
  voucherValidUntil: Date | null;
}) {
  if (!order.voucherCode || !order.voucherValidUntil) return null;
  return {
    qrToken: buildVoucherToken(order.publicId, order.venueId, order.voucherValidUntil),
    code: order.voucherCode,
    validUntil: order.voucherValidUntil.toISOString(),
  };
}

export async function getVoucher(userId: bigint, publicId: string) {
  const order = await loadCustomerOrder(userId, publicId);
  const voucher =
    order.status === 'paid' && order.voucherStatus === 'active' ? voucherOf(order) : null;
  if (!voucher)
    throw new AppError('ORDER_STATE_CONFLICT', 'Ваучер доступний лише для оплаченого замовлення');
  return voucher;
}

export async function retryPayment(userId: bigint, publicId: string) {
  const order = await loadCustomerOrder(userId, publicId);
  if (order.status !== 'pending_payment' || order.reservedUntil <= new Date()) {
    throw new AppError('ORDER_STATE_CONFLICT', 'Час на оплату вийшов, оформіть замовлення ще раз');
  }
  return prisma.$transaction((tx) => createPaymentAttempt(tx, order, order.listing.offer.title));
}

export async function cancelByCustomer(userId: bigint, publicId: string, reason?: string) {
  const order = await loadCustomerOrder(userId, publicId);
  const settings = await getSettings();

  await publishAfterCommit(async (after) => {
    const refundNeeded = await prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, order.id);
      if (locked.status === 'paid') {
        const deadline = addMinutes(locked.pickupStart, -settings.cancel_deadline_hours * 60);
        if (new Date() > deadline) {
          throw businessRule(
            `Скасувати замовлення можна не пізніше ніж за ${settings.cancel_deadline_hours} год до початку самовивозу`,
          );
        }
      } else if (locked.status !== 'pending_payment') {
        throw new AppError('ORDER_STATE_CONFLICT');
      }

      await tx.order.update({
        where: { id: locked.id },
        data: {
          status: 'cancelled_by_customer',
          cancelReason: reason ?? null,
          ...(locked.voucherStatus ? { voucherStatus: 'expired' } : {}),
        },
      });
      await recordStatus(
        tx,
        locked.id,
        locked.status,
        'cancelled_by_customer',
        { type: 'customer', id: userId },
        reason,
      );
      await releaseStock(tx, locked.listingId, locked.quantity);
      listingChanged(after, locked.listingId);
      orderChanged(after, locked, locked.status, 'cancelled_by_customer');
      notifyOrderAfterCommit(after, locked.id, {
        kind: 'cancelled_by_customer',
        refund: locked.status === 'paid',
      });
      return locked.status === 'paid';
    });

    if (refundNeeded) {
      await refundOrderPayment(order.id, order.totalAmount, reason ?? 'Скасовано покупцем', {
        type: 'customer',
        id: userId,
      });
    }
  });
  return getOrder(userId, publicId);
}
