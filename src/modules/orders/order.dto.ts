import type { Prisma } from '../../generated/prisma/client.js';
import { formatMoney } from '../../lib/money.js';
import { dbToDateOnly } from '../../lib/time.js';

export const customerOrderInclude = {
  listing: { include: { offer: { select: { id: true, title: true, photoUrl: true } } } },
  venue: {
    select: { id: true, slug: true, name: true, address: true, lat: true, lng: true, phone: true },
  },
} satisfies Prisma.OrderInclude;

export type CustomerOrder = Prisma.OrderGetPayload<{ include: typeof customerOrderInclude }>;

export function toCustomerOrderDto(order: CustomerOrder) {
  return {
    publicId: order.publicId,
    status: order.status,
    quantity: order.quantity,
    unitPrice: formatMoney(order.unitPrice),
    unitOriginalPrice: formatMoney(order.unitOriginalPrice),
    totalAmount: formatMoney(order.totalAmount),
    savingAmount: formatMoney(order.savingAmount),
    reservedUntil: order.reservedUntil.toISOString(),
    pickupDate: dbToDateOnly(order.pickupDate),
    pickupStart: order.pickupStart.toISOString(),
    pickupEnd: order.pickupEnd.toISOString(),
    pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    listingId: Number(order.listingId),
    offer: {
      id: Number(order.listing.offer.id),
      title: order.listing.offer.title,
      photoUrl: order.listing.offer.photoUrl,
    },
    venue: {
      id: Number(order.venue.id),
      slug: order.venue.slug,
      name: order.venue.name,
      address: order.venue.address,
      phone: order.venue.phone,
      lat: order.venue.lat.toNumber(),
      lng: order.venue.lng.toNumber(),
    },
    hasVoucher: order.status === 'paid' && order.voucherStatus === 'active',
    createdAt: order.createdAt.toISOString(),
  };
}
