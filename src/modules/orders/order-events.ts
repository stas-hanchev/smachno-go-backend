import { env } from '../../config/env.js';
import type { OrderStatus } from '../../generated/prisma/client.js';
import type { AfterCommit } from '../../lib/after-commit.js';
import { formatMoney } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { emit, rooms } from '../../lib/realtime.js';
import { dbToDateOnly, kyivTime } from '../../lib/time.js';
import { notify, type NotificationInput } from '../notifications/notifications.service.js';

export interface OrderRef {
  id: bigint;
  publicId: string;
  userId: bigint;
  venueId: bigint;
}

export async function publishListingUpdate(listingId: bigint): Promise<void> {
  const listing = await prisma.offerListing.findUnique({
    where: { id: listingId },
    select: { id: true, venueId: true, quantityLeft: true, quantityTotal: true, status: true },
  });
  if (!listing) return;
  const payload = {
    listingId: Number(listing.id),
    quantityLeft: listing.quantityLeft,
    quantityTotal: listing.quantityTotal,
    status: listing.status,
  };
  emit(rooms.listing(listing.id), 'listing:updated', payload);
  emit(rooms.venue(listing.venueId), 'listing:updated', payload);
}

export function listingChanged(after: AfterCommit, listingId: bigint): void {
  after.add(() => publishListingUpdate(listingId));
}

const HIDDEN_FROM_VENUE: (OrderStatus | null)[] = [null, 'pending_payment', 'expired'];

export function orderChanged(
  after: AfterCommit,
  order: OrderRef,
  from: OrderStatus | null,
  to: OrderStatus,
): void {
  const payload = { publicId: order.publicId, status: to };
  after.emit(rooms.user(order.userId), 'order:status', payload);
  if (to === 'paid') {
    after.emit(
      rooms.venue(order.venueId),
      from === 'paid' ? 'order:updated' : 'order:new',
      payload,
    );
  } else if (!HIDDEN_FROM_VENUE.includes(from)) {
    after.emit(rooms.venue(order.venueId), 'order:updated', payload);
  }
}

export type OrderNotice =
  | { kind: 'paid' }
  | { kind: 'cancelled_by_customer'; refund: boolean }
  | { kind: 'cancelled_by_venue'; refund: boolean; reason: string }
  | { kind: 'late_payment_refunded' }
  | { kind: 'refunded'; reason: string }
  | { kind: 'pickup_reminder' };

async function buildOrderNotice(orderId: bigint, notice: OrderNotice) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      listing: { include: { offer: { select: { title: true } } } },
      venue: { select: { name: true, address: true } },
      user: { select: { firstName: true } },
    },
  });
  if (!order) return null;

  const title = order.listing.offer.title;
  const amount = `${formatMoney(order.totalAmount)} грн`;
  const window = `${dbToDateOnly(order.pickupDate)} з ${kyivTime(order.pickupStart)} до ${kyivTime(order.pickupEnd)}`;
  const link = `${env.APP_URL}/orders/${order.publicId}`;
  const greeting = `Вітаємо, ${order.user.firstName}!`;
  const refundLine = 'Кошти повернуться на картку протягом 1–7 банківських днів.';
  const data = { orderPublicId: order.publicId };

  const base = { userId: order.userId, data };
  let input: NotificationInput;
  switch (notice.kind) {
    case 'paid':
      input = {
        ...base,
        type: 'order_paid',
        category: 'order_updates',
        title: 'Замовлення оплачено',
        body: `«${title}» у ${order.venue.name}. Код видачі: ${order.voucherCode ?? '—'}. Самовивіз ${window}.`,
        email: {
          subject: `Замовлення оплачено: ${title}`,
          text: `${greeting}\n\nОплату ${amount} отримано. Ваш набір «${title}» чекає на вас у ${order.venue.name} (${order.venue.address}).\n\nСамовивіз: ${window}\nКод видачі: ${order.voucherCode ?? '—'}\n\nQR-код ваучера: ${link}`,
        },
      };
      break;
    case 'cancelled_by_customer':
      input = {
        ...base,
        type: 'order_cancelled',
        category: 'order_updates',
        title: 'Замовлення скасовано',
        body: `Ви скасували «${title}».${notice.refund ? ` ${refundLine}` : ''}`,
        email: {
          subject: `Замовлення скасовано: ${title}`,
          text: `${greeting}\n\nЗамовлення «${title}» у ${order.venue.name} скасовано.${notice.refund ? `\n\nПовертаємо ${amount}. ${refundLine}` : ''}\n\n${link}`,
        },
      };
      break;
    case 'cancelled_by_venue':
      input = {
        ...base,
        type: 'order_cancelled',
        category: 'order_updates',
        title: 'Заклад скасував замовлення',
        body: `${order.venue.name} скасував «${title}»: ${notice.reason}.${notice.refund ? ` ${refundLine}` : ''}`,
        email: {
          subject: `Заклад скасував замовлення: ${title}`,
          text: `${greeting}\n\nНа жаль, ${order.venue.name} скасував ваше замовлення «${title}».\nПричина: ${notice.reason}${notice.refund ? `\n\nПовертаємо ${amount}. ${refundLine}` : ''}\n\n${link}`,
        },
      };
      break;
    case 'late_payment_refunded':
      input = {
        ...base,
        type: 'order_refunded',
        category: 'order_updates',
        title: 'Оплату повернено',
        body: `Оплата за «${title}» надійшла після завершення резерву, а набори вже розібрали. ${refundLine}`,
        email: {
          subject: `Оплату повернено: ${title}`,
          text: `${greeting}\n\nОплата ${amount} за «${title}» надійшла після завершення часу резерву, і вільних наборів уже не лишилося. Ми повертаємо кошти. ${refundLine}\n\n${link}`,
        },
      };
      break;
    case 'refunded':
      input = {
        ...base,
        type: 'order_refunded',
        category: 'order_updates',
        title: 'Кошти повернено',
        body: `Повернення за «${title}»: ${notice.reason}. ${refundLine}`,
        email: {
          subject: `Повернення коштів: ${title}`,
          text: `${greeting}\n\nМи повертаємо ${amount} за замовлення «${title}».\nПричина: ${notice.reason}\n\n${refundLine}\n\n${link}`,
        },
      };
      break;
    case 'pickup_reminder':
      input = {
        ...base,
        type: 'pickup_reminder',
        category: 'pickup_reminders',
        title: 'Скоро самовивіз',
        body: `«${title}» чекає на вас у ${order.venue.name} з ${kyivTime(order.pickupStart)} до ${kyivTime(order.pickupEnd)}.`,
        email: {
          subject: `Нагадування: самовивіз о ${kyivTime(order.pickupStart)}`,
          text: `${greeting}\n\nЧерез пів години починається самовивіз «${title}» у ${order.venue.name} (${order.venue.address}): ${window}.\nКод видачі: ${order.voucherCode ?? '—'}\n\n${link}`,
        },
      };
      break;
  }
  return input;
}

export async function notifyOrder(orderId: bigint, notice: OrderNotice): Promise<void> {
  const input = await buildOrderNotice(orderId, notice);
  if (input) await notify(input);
}

export function notifyOrderAfterCommit(
  after: AfterCommit,
  orderId: bigint,
  notice: OrderNotice,
): void {
  after.add(() => notifyOrder(orderId, notice));
}
