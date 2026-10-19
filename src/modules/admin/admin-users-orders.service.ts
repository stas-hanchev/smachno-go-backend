import type { OrderStatus, Prisma, UserRole, UserStatus } from '../../generated/prisma/client.js';
import { publishAfterCommit } from '../../lib/after-commit.js';
import { audit } from '../../lib/audit.js';
import { AppError, businessRule, forbidden, notFound } from '../../lib/errors.js';
import { formatMoney } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { dateOnlyToDb, dbToDateOnly } from '../../lib/time.js';
import { revokeAllRefreshTokens } from '../auth/tokens.js';
import { lockOrder, recordStatus, refundOrderPayment, releaseStock } from '../orders/order-core.js';
import { listingChanged, notifyOrderAfterCommit, orderChanged } from '../orders/order-events.js';
import { toUserDto } from '../users/user.dto.js';
import type { AdminActor, Page } from './admin-partners.service.js';

const paging = (p: Page) => ({ skip: (p.page - 1) * p.limit, take: p.limit });
const meta = (p: Page, total: number) => ({ page: p.page, limit: p.limit, total });
const isAdminRole = (role: UserRole) => role === 'admin' || role === 'super_admin';

export async function listUsers(
  filter: { q?: string; role?: UserRole; status?: UserStatus } & Page,
) {
  const where: Prisma.UserWhereInput = {
    ...(filter.role && { role: filter.role }),
    ...(filter.status ? { status: filter.status } : { status: { not: 'deleted' } }),
    ...(filter.q && {
      OR: [
        { email: { contains: filter.q } },
        { firstName: { contains: filter.q } },
        { lastName: { contains: filter.q } },
      ],
    }),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { id: 'desc' }, ...paging(filter) }),
    prisma.user.count({ where }),
  ]);
  return {
    data: items.map((u) => ({
      ...toUserDto(u),
      status: u.status,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
    meta: meta(filter, total),
  };
}

export async function getUser(id: bigint) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      venueMemberships: { include: { venue: { select: { id: true, name: true, status: true } } } },
      _count: { select: { orders: true } },
    },
  });
  if (!user) throw notFound('Користувача не знайдено');
  return {
    ...toUserDto(user),
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    ordersCount: user._count.orders,
    venues: user.venueMemberships.map((m) => ({
      id: Number(m.venue.id),
      name: m.venue.name,
      venueStatus: m.venue.status,
      role: m.role,
      status: m.status,
    })),
  };
}

export async function updateUser(
  id: bigint,
  input: { status?: 'active' | 'blocked'; role?: UserRole },
  actor: AdminActor,
) {
  if (id === actor.id) throw businessRule('Не можна змінити власний обліковий запис');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.status === 'deleted') throw notFound('Користувача не знайдено');
  const touchesAdmins =
    isAdminRole(user.role) || (input.role !== undefined && isAdminRole(input.role));
  if (touchesAdmins && actor.role !== 'super_admin') {
    throw forbidden('Керувати адміністраторами може лише супер-адміністратор');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.role !== undefined && { role: input.role }),
      },
    });
    await audit(
      {
        actorId: actor.id,
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        diff: { before: { status: user.status, role: user.role }, after: input },
        ip: actor.ip,
      },
      tx,
    );
  });
  if (input.status === 'blocked' || (input.role && input.role !== user.role)) {
    await revokeAllRefreshTokens(id);
  }
  return getUser(id);
}

const ORDER_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const PUBLIC_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export async function listOrders(
  filter: { q?: string; status?: OrderStatus; venueId?: number; date?: string } & Page,
) {
  const q = filter.q?.trim();
  let search: Prisma.OrderWhereInput = {};
  if (q && PUBLIC_ID.test(q.toUpperCase())) search = { publicId: q.toUpperCase() };
  else if (q && ORDER_CODE.test(q.toUpperCase())) search = { voucherCode: q.toUpperCase() };
  else if (q) search = { user: { email: { contains: q.toLowerCase() } } };

  const where: Prisma.OrderWhereInput = {
    ...search,
    ...(filter.status && { status: filter.status }),
    ...(filter.venueId && { venueId: filter.venueId }),
    ...(filter.date && { pickupDate: dateOnlyToDb(filter.date) }),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        user: { select: { email: true } },
        venue: { select: { id: true, name: true } },
        listing: { include: { offer: { select: { title: true } } } },
      },
      orderBy: { id: 'desc' },
      ...paging(filter),
    }),
    prisma.order.count({ where }),
  ]);
  return {
    data: items.map((o) => ({
      publicId: o.publicId,
      status: o.status,
      customerEmail: o.user.email,
      venue: { id: Number(o.venue.id), name: o.venue.name },
      offerTitle: o.listing.offer.title,
      quantity: o.quantity,
      totalAmount: formatMoney(o.totalAmount),
      voucherCode: o.voucherCode,
      pickupDate: dbToDateOnly(o.pickupDate),
      pickupStart: o.pickupStart.toISOString(),
      createdAt: o.createdAt.toISOString(),
    })),
    meta: meta(filter, total),
  };
}

export async function getOrder(publicId: string) {
  const order = await prisma.order.findUnique({
    where: { publicId },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      venue: { select: { id: true, name: true } },
      listing: { include: { offer: { select: { title: true } } } },
      statusHistory: { orderBy: { id: 'asc' } },
      payments: { include: { refunds: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } },
    },
  });
  if (!order) throw notFound('Замовлення не знайдено');
  return {
    publicId: order.publicId,
    status: order.status,
    customer: {
      id: Number(order.user.id),
      email: order.user.email,
      name: [order.user.firstName, order.user.lastName].filter(Boolean).join(' '),
    },
    venue: { id: Number(order.venue.id), name: order.venue.name },
    offerTitle: order.listing.offer.title,
    listingId: Number(order.listingId),
    quantity: order.quantity,
    unitPrice: formatMoney(order.unitPrice),
    totalAmount: formatMoney(order.totalAmount),
    commissionAmount: formatMoney(order.commissionAmount),
    voucherCode: order.voucherCode,
    voucherStatus: order.voucherStatus,
    pickupDate: dbToDateOnly(order.pickupDate),
    pickupStart: order.pickupStart.toISOString(),
    pickupEnd: order.pickupEnd.toISOString(),
    pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt.toISOString(),
    statusHistory: order.statusHistory.map((h) => ({
      from: h.fromStatus,
      to: h.toStatus,
      actorType: h.actorType,
      actorId: h.actorId ? Number(h.actorId) : null,
      note: h.note,
      at: h.createdAt.toISOString(),
    })),
    payments: order.payments.map((p) => ({
      id: Number(p.id),
      provider: p.provider,
      providerOrderId: p.providerOrderId,
      providerPaymentId: p.providerPaymentId,
      amount: formatMoney(p.amount),
      method: p.method,
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      refunds: p.refunds.map((r) => ({
        id: Number(r.id),
        amount: formatMoney(r.amount),
        reason: r.reason,
        initiatedBy: r.initiatedBy,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
    })),
  };
}

const REFUNDABLE_STATUSES: OrderStatus[] = ['paid', 'picked_up', 'no_show'];

export async function refundOrder(publicId: string, reason: string, actor: AdminActor) {
  const order = await prisma.order.findUnique({ where: { publicId } });
  if (!order) throw notFound('Замовлення не знайдено');
  const payment = await prisma.payment.findFirst({
    where: { orderId: order.id, status: 'success' },
    orderBy: { id: 'desc' },
  });
  if (!payment) {
    throw new AppError('ORDER_STATE_CONFLICT', 'Для замовлення немає оплати, яку можна повернути');
  }

  await publishAfterCommit(async (after) => {
    await prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, order.id);
      if (REFUNDABLE_STATUSES.includes(locked.status)) {
        await tx.order.update({
          where: { id: locked.id },
          data: {
            status: 'refunded',
            ...(locked.voucherStatus === 'active' && { voucherStatus: 'expired' }),
          },
        });
        await recordStatus(
          tx,
          locked.id,
          locked.status,
          'refunded',
          { type: 'admin', id: actor.id },
          reason,
        );
        if (locked.status === 'paid') {
          await releaseStock(tx, locked.listingId, locked.quantity);
          listingChanged(after, locked.listingId);
        }
        orderChanged(after, locked, locked.status, 'refunded');
      }
      await audit(
        {
          actorId: actor.id,
          action: 'order.refund',
          entityType: 'order',
          entityId: locked.id,
          diff: { publicId, reason, amount: formatMoney(payment.amount), status: locked.status },
          ip: actor.ip,
        },
        tx,
      );
    });
    await refundOrderPayment(
      order.id,
      payment.amount,
      reason,
      { type: 'admin', id: actor.id },
      payment.id,
    );
    notifyOrderAfterCommit(after, order.id, { kind: 'refunded', reason });
  });
  return getOrder(publicId);
}
