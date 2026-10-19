import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { expirePendingOrders, remindPickup } from '../../src/jobs/order-jobs.js';
import { sentMail } from '../../src/lib/mailer.js';
import { prisma } from '../../src/lib/prisma.js';
import { emittedEvents } from '../../src/lib/realtime.js';
import { encodeLiqpayData, liqpaySignature } from '../../src/modules/payments/liqpay.js';
import { createDictionaries, createUser, createVenueWithListing, resetDb } from './fixtures.js';

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PRIVATE_KEY = 'sandbox_test_private_key';

async function setup(quantity: number) {
  await resetDb();
  sentMail.length = 0;
  emittedEvents.length = 0;
  const { city, category } = await createDictionaries();
  const owner = await createUser();
  const data = await createVenueWithListing({
    ownerId: owner.user.id,
    cityId: city.id,
    categoryId: category.id,
    slug: 'test-cafe',
    lat: 50.4475,
    lng: 30.5222,
    quantity,
  });
  return { owner, ...data };
}

async function order(token: string, listingId: bigint, quantity = 1) {
  const res = await request(app)
    .post('/api/v1/orders')
    .set(auth(token))
    .send({ listingId: Number(listingId), quantity });
  expect(res.status).toBe(201);
  const payment = await prisma.payment.findFirstOrThrow({
    where: { order: { publicId: res.body.order.publicId } },
    orderBy: { id: 'desc' },
  });
  return { publicId: res.body.order.publicId as string, payment };
}

function callback(payload: Record<string, string | number>, signatureKey = PRIVATE_KEY) {
  const data = encodeLiqpayData({ version: 3, public_key: 'sandbox_i00000000', ...payload });
  return request(app)
    .post('/api/v1/payments/liqpay/callback')
    .type('form')
    .send({ data, signature: liqpaySignature(data, signatureKey) });
}

const successPayload = (providerOrderId: string, amount: string) => ({
  action: 'pay',
  status: 'success',
  order_id: providerOrderId,
  payment_id: Math.floor(Math.random() * 1e9),
  paytype: 'card',
  amount: Number(amount),
  currency: 'UAH',
});

const mailsWithSubject = (prefix: string) =>
  sentMail.filter((m) => m.subject.startsWith(prefix)).length;

describe('LiqPay callback', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('pays once and ignores a repeated callback (TZ 12.2 #4)', async () => {
    const { listing, venue } = await setup(3);
    const buyer = await createUser();
    const { publicId, payment } = await order(buyer.token, listing.id);
    const payload = successPayload(payment.providerOrderId, payment.amount.toFixed(2));

    const first = await callback(payload);
    expect(first.status).toBe(200);
    const paid = await prisma.order.findUniqueOrThrow({ where: { publicId } });
    expect(paid.status).toBe('paid');
    expect(paid.voucherCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const historyBefore = await prisma.orderStatusHistory.count({ where: { orderId: paid.id } });

    const repeat = await callback(payload);
    expect(repeat.status).toBe(200);
    const after = await prisma.order.findUniqueOrThrow({ where: { publicId } });
    expect(after.status).toBe('paid');
    expect(after.voucherCode).toBe(paid.voucherCode);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: paid.id } })).toBe(
      historyBefore,
    );
    expect(mailsWithSubject('Замовлення оплачено')).toBe(1);
    expect(await prisma.notification.count({ where: { type: 'order_paid' } })).toBe(1);

    const logs = await prisma.paymentWebhookLog.findMany({ orderBy: { id: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.signatureValid && l.processed)).toBe(true);

    const venueEvents = emittedEvents.filter((e) => e.room === `venue:${venue.id}`);
    expect(venueEvents.filter((e) => e.event === 'order:new')).toHaveLength(1);
    expect(
      emittedEvents.some((e) => e.room === `user:${buyer.user.id}` && e.event === 'order:status'),
    ).toBe(true);
  });

  it('rejects a forged signature and a wrong amount', async () => {
    const { listing } = await setup(3);
    const buyer = await createUser();
    const { publicId, payment } = await order(buyer.token, listing.id);

    const forged = await callback(
      successPayload(payment.providerOrderId, payment.amount.toFixed(2)),
      'attacker-key',
    );
    expect(forged.status).toBe(400);

    const cheap = await callback(successPayload(payment.providerOrderId, '1.00'));
    expect(cheap.status).toBe(200);

    expect((await prisma.order.findUniqueOrThrow({ where: { publicId } })).status).toBe(
      'pending_payment',
    );
    const logs = await prisma.paymentWebhookLog.findMany({ orderBy: { id: 'asc' } });
    expect(logs.map((l) => [l.signatureValid, l.processed, l.error])).toEqual([
      [false, false, 'Invalid signature'],
      [true, false, 'amount_mismatch'],
    ]);
  });

  it('keeps the order pending while LiqPay waits for 3-D Secure, then records a failure', async () => {
    const { listing } = await setup(3);
    const buyer = await createUser();
    const { publicId, payment } = await order(buyer.token, listing.id);

    await callback({ ...successPayload(payment.providerOrderId, '89.00'), status: '3ds_verify' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'processing',
    );
    await callback({ ...successPayload(payment.providerOrderId, '89.00'), status: 'failure' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'failure',
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { publicId } })).status).toBe(
      'pending_payment',
    );
  });

  it('refunds a payment that arrives after the reservation expired and stock ran out (TZ 12.2 #3)', async () => {
    const { listing } = await setup(1);
    const late = await createUser();
    const first = await order(late.token, listing.id);

    await prisma.order.updateMany({ data: { reservedUntil: new Date(Date.now() - 1000) } });
    expect(await expirePendingOrders()).toBe(1);

    const other = await createUser();
    const second = await order(other.token, listing.id);
    await callback(successPayload(second.payment.providerOrderId, '89.00'));
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { publicId: second.publicId } })).status,
    ).toBe('paid');

    sentMail.length = 0;
    const res = await callback(successPayload(first.payment.providerOrderId, '89.00'));
    expect(res.status).toBe(200);

    const refunded = await prisma.order.findUniqueOrThrow({ where: { publicId: first.publicId } });
    expect(refunded.status).toBe('refunded');
    expect(refunded.voucherCode).toBeNull();
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: first.payment.id },
      include: { refunds: true },
    });
    expect(payment.status).toBe('reversed');
    expect(payment.refunds).toHaveLength(1);
    expect(payment.refunds[0]?.status).toBe('success');
    expect(payment.refunds[0]?.initiatedBy).toBe('system');
    expect(mailsWithSubject('Оплату повернено')).toBe(1);
    expect(
      (await prisma.offerListing.findUniqueOrThrow({ where: { id: listing.id } })).quantityLeft,
    ).toBe(0);

    await callback(successPayload(first.payment.providerOrderId, '89.00'));
    expect(await prisma.refund.count()).toBe(1);
    expect(mailsWithSubject('Оплату повернено')).toBe(1);
  });

  it('redirects back to the order page from the LiqPay return URL', async () => {
    const { listing } = await setup(3);
    const buyer = await createUser();
    const { publicId, payment } = await order(buyer.token, listing.id);
    const res = await request(app).get(
      `/api/v1/payments/liqpay/return?orderId=${payment.providerOrderId}`,
    );
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`http://localhost:3000/orders/${publicId}?payment=return`);
  });
});

describe('order notifications', () => {
  it('emails the customer when the venue cancels a paid order and refunds it', async () => {
    const { listing, venue, owner } = await setup(3);
    const buyer = await createUser();
    const { publicId, payment } = await order(buyer.token, listing.id);
    await callback(successPayload(payment.providerOrderId, '89.00'));
    emittedEvents.length = 0;

    const res = await request(app)
      .post(`/api/v1/partner/venues/${venue.id}/orders/${publicId}/cancel`)
      .set(auth(owner.token))
      .send({ reason: 'Закінчилися продукти' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled_by_venue');
    expect(await prisma.refund.count({ where: { status: 'success', initiatedBy: 'venue' } })).toBe(
      1,
    );
    expect(mailsWithSubject('Заклад скасував замовлення')).toBe(1);
    expect(sentMail.at(-1)?.text).toContain('Закінчилися продукти');
    expect(emittedEvents.map((e) => `${e.room} ${e.event}`)).toEqual(
      expect.arrayContaining([
        `listing:${listing.id} listing:updated`,
        `user:${buyer.user.id} order:status`,
        `venue:${venue.id} order:updated`,
        `user:${buyer.user.id} notification:new`,
      ]),
    );
  });

  it('respects email settings and sends the pickup reminder once', async () => {
    const { listing } = await setup(3);
    const buyer = await createUser();
    const muted = await createUser();
    await prisma.notificationSettings.create({
      data: { userId: muted.user.id, pickupReminders: false },
    });
    for (const u of [buyer, muted]) {
      const { payment } = await order(u.token, listing.id);
      await callback(successPayload(payment.providerOrderId, '89.00'));
    }
    await prisma.order.updateMany({ data: { pickupStart: new Date(Date.now() + 20 * 60_000) } });

    sentMail.length = 0;
    expect(await remindPickup()).toBe(2);
    expect(await remindPickup()).toBe(0);
    expect(sentMail.filter((m) => m.subject.startsWith('Нагадування'))).toHaveLength(1);
    expect(await prisma.notification.count({ where: { type: 'pickup_reminder' } })).toBe(2);

    const list = await request(app).get('/api/v1/me/notifications').set(auth(muted.token));
    expect(list.status).toBe(200);
    expect(list.body.unread).toBe(2);
    const read = await request(app)
      .post('/api/v1/me/notifications/read')
      .set(auth(muted.token))
      .send({});
    expect(read.body.updated).toBe(2);
  });
});
