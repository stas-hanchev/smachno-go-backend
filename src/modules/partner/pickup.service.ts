import type { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import { AppError, businessRule, notFound } from '../../lib/errors.js';
import { formatMoney } from '../../lib/money.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { dateOnlyToDb, dbToDateOnly, kyivDate } from '../../lib/time.js';
import { lockOrder, recordStatus, refundOrderPayment, releaseStock } from '../orders/order-core.js';
import { parseVoucherToken, voucherTokenHash } from '../orders/voucher.js';

const venueOrderInclude = {
  user: { select: { firstName: true, lastName: true } },
  listing: { include: { offer: { select: { title: true } } } },
} satisfies Prisma.OrderInclude;

type VenueOrder = Prisma.OrderGetPayload<{ include: typeof venueOrderInclude }>;

function customerDisplayName(user: { firstName: string; lastName: string | null }): string {
  return user.lastName ? `${user.firstName} ${user.lastName.charAt(0)}.` : user.firstName;
}

function toVenueOrderDto(order: VenueOrder) {
  return {
    publicId: order.publicId,
    status: order.status,
    customerName: customerDisplayName(order.user),
    offerTitle: order.listing.offer.title,
    listingId: Number(order.listingId),
    quantity: order.quantity,
    totalAmount: formatMoney(order.totalAmount),
    pickupDate: dbToDateOnly(order.pickupDate),
    pickupStart: order.pickupStart.toISOString(),
    pickupEnd: order.pickupEnd.toISOString(),
    voucherCode: order.status === 'picked_up' ? order.voucherCode : null,
    voucherValidUntil: order.voucherValidUntil?.toISOString() ?? null,
    pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

export async function listVenueOrders(venueId: bigint, date?: string, status?: OrderStatus) {
  const orders = await prisma.order.findMany({
    where: {
      venueId,
      pickupDate: dateOnlyToDb(date ?? kyivDate()),
      ...(status ? { status } : { status: { not: 'pending_payment' } }),
    },
    include: venueOrderInclude,
    orderBy: [{ pickupStart: 'asc' }, { createdAt: 'asc' }],
  });
  return orders.map(toVenueOrderDto);
}

async function findVoucherOrder(venueId: bigint, input: { qrToken?: string; code?: string }) {
  let order: VenueOrder | null = null;
  if (input.qrToken) {
    const claims = parseVoucherToken(input.qrToken);
    if (!claims) throw new AppError('INVALID_TOKEN', 'QR-код недійсний');
    if (claims.venueId !== venueId) throw businessRule('Це замовлення іншого закладу');
    order = await prisma.order.findUnique({
      where: { voucherTokenHash: voucherTokenHash(input.qrToken) },
      include: venueOrderInclude,
    });
  } else if (input.code) {
    order = await prisma.order.findFirst({
      where: {
        venueId,
        pickupDate: dateOnlyToDb(kyivDate()),
        voucherCode: input.code.toUpperCase(),
      },
      include: venueOrderInclude,
    });
  }
  if (!order || order.venueId !== venueId) throw notFound('Замовлення з таким кодом не знайдено');
  return order;
}

function assertPickable(order: VenueOrder) {
  if (order.status === 'picked_up')
    throw new AppError('ORDER_STATE_CONFLICT', 'Замовлення вже видано');
  if (order.status !== 'paid' || order.voucherStatus !== 'active') {
    throw new AppError('ORDER_STATE_CONFLICT', 'Замовлення не оплачене або скасоване');
  }
  if (!order.voucherValidUntil || order.voucherValidUntil < new Date()) {
    throw businessRule('Термін дії ваучера минув');
  }
}

export async function verifyPickup(venueId: bigint, input: { qrToken?: string; code?: string }) {
  const order = await findVoucherOrder(venueId, input);
  assertPickable(order);
  return toVenueOrderDto(order);
}

async function addSavedStats(
  tx: Tx,
  order: { userId: bigint; quantity: number; savingAmount: Prisma.Decimal; listingId: bigint },
) {
  const settings = await getSettings();
  const listing = await tx.offerListing.findUniqueOrThrow({
    where: { id: order.listingId },
    include: { offer: { select: { estWeightKg: true } } },
  });
  const kg = listing.offer.estWeightKg.times(order.quantity);
  const stats = await tx.userStats.upsert({
    where: { userId: order.userId },
    create: {
      userId: order.userId,
      savedCount: order.quantity,
      savedKg: kg,
      savedMoney: order.savingAmount,
      co2Kg: kg.times(settings.co2_per_kg),
    },
    update: {
      savedCount: { increment: order.quantity },
      savedKg: { increment: kg },
      savedMoney: { increment: order.savingAmount },
      co2Kg: { increment: kg.times(settings.co2_per_kg) },
    },
  });
  const level = await tx.level.findFirst({
    where: { minSavedCount: { lte: stats.savedCount } },
    orderBy: { minSavedCount: 'desc' },
  });
  if (level && level.id !== stats.levelId) {
    await tx.userStats.update({ where: { userId: order.userId }, data: { levelId: level.id } });
  }
}

export async function pickupOrder(venueId: bigint, publicId: string, staffUserId: bigint) {
  const order = await prisma.order.findUnique({ where: { publicId }, include: venueOrderInclude });
  if (!order || order.venueId !== venueId) throw notFound('Замовлення не знайдено');

  await prisma.$transaction(async (tx) => {
    const locked = await lockOrder(tx, order.id);
    assertPickable({ ...order, ...locked });
    await tx.order.update({
      where: { id: locked.id },
      data: {
        status: 'picked_up',
        voucherStatus: 'used',
        pickedUpAt: new Date(),
        pickedUpBy: staffUserId,
      },
    });
    await recordStatus(tx, locked.id, locked.status, 'picked_up', {
      type: 'venue',
      id: staffUserId,
    });
    await addSavedStats(tx, locked);
    await tx.interaction.create({
      data: {
        userId: locked.userId,
        offerId: order.listing.offerId,
        venueId,
        type: 'pickup',
      },
    });
  });

  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: venueOrderInclude,
  });
  return toVenueOrderDto(updated);
}

async function cancelOrderByVenue(
  orderId: bigint,
  reason: string,
  actorId: bigint,
): Promise<boolean> {
  const refund = await prisma.$transaction(async (tx) => {
    const locked = await lockOrder(tx, orderId);
    if (locked.status !== 'paid' && locked.status !== 'pending_payment') return null;
    await tx.order.update({
      where: { id: locked.id },
      data: {
        status: 'cancelled_by_venue',
        cancelReason: reason,
        ...(locked.voucherStatus ? { voucherStatus: 'expired' } : {}),
      },
    });
    await recordStatus(
      tx,
      locked.id,
      locked.status,
      'cancelled_by_venue',
      { type: 'venue', id: actorId },
      reason,
    );
    await releaseStock(tx, locked.listingId, locked.quantity);
    return locked.status === 'paid' ? locked : null;
  });
  if (refund) {
    await refundOrderPayment(refund.id, refund.totalAmount, reason, { type: 'venue', id: actorId });
  }
  return refund !== null;
}

export async function cancelVenueOrder(
  venueId: bigint,
  publicId: string,
  reason: string,
  actorId: bigint,
) {
  const order = await prisma.order.findUnique({ where: { publicId } });
  if (!order || order.venueId !== venueId) throw notFound('Замовлення не знайдено');
  if (order.status !== 'paid' && order.status !== 'pending_payment') {
    throw new AppError('ORDER_STATE_CONFLICT');
  }
  await cancelOrderByVenue(order.id, reason, actorId);
  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: venueOrderInclude,
  });
  return toVenueOrderDto(updated);
}

export async function cancelListing(
  venueId: bigint,
  listingId: bigint,
  reason: string,
  actorId: bigint,
) {
  const listing = await prisma.offerListing.findFirst({ where: { id: listingId, venueId } });
  if (!listing) throw notFound('Випуск не знайдено');
  if (listing.status === 'cancelled')
    throw new AppError('ORDER_STATE_CONFLICT', 'Випуск вже скасовано');

  await prisma.offerListing.update({
    where: { id: listingId },
    data: { status: 'cancelled', cancelReason: reason },
  });
  const orders = await prisma.order.findMany({
    where: { listingId, status: { in: ['paid', 'pending_payment'] } },
    select: { id: true },
  });
  let refunded = 0;
  for (const order of orders) {
    if (await cancelOrderByVenue(order.id, reason, actorId)) refunded += 1;
  }
  return { cancelledOrders: orders.length, refundedOrders: refunded };
}
