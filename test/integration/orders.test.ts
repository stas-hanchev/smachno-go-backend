import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { expirePendingOrders } from '../../src/jobs/order-jobs.js';
import { prisma } from '../../src/lib/prisma.js';
import { createDictionaries, createUser, createVenueWithListing, resetDb } from './fixtures.js';

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function setup(quantity: number) {
  await resetDb();
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

async function pay(token: string, checkoutUrl: string, result: 'success' | 'failure' = 'success') {
  return request(app).post(checkoutUrl).set(auth(token)).send({ result });
}

describe('orders', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('sells exactly the remaining 3 sets to 50 concurrent buyers (TZ 12.2 #2)', async () => {
    const { listing } = await setup(3);
    const buyers = await Promise.all(Array.from({ length: 50 }, () => createUser()));

    const responses = await Promise.all(
      buyers.map((b) =>
        request(app)
          .post('/api/v1/orders')
          .set(auth(b.token))
          .send({ listingId: Number(listing.id), quantity: 1 }),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);
    expect(created).toHaveLength(3);
    expect(rejected).toHaveLength(47);
    expect(rejected[0]?.body.error.code).toBe('LISTING_UNAVAILABLE');

    const after = await prisma.offerListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.quantityLeft).toBe(0);
    expect(after.status).toBe('sold_out');

    for (const r of created) {
      const buyer = buyers[responses.indexOf(r)]!;
      expect((await pay(buyer.token, r.body.payment.checkoutUrl)).body.outcome).toBe('paid');
    }
    expect(await prisma.order.count({ where: { listingId: listing.id, status: 'paid' } })).toBe(3);
  });

  it('goes from reservation to payment, voucher and pickup', async () => {
    const { owner, venue, listing } = await setup(5);
    const buyer = await createUser();

    const created = await request(app)
      .post('/api/v1/orders')
      .set(auth(buyer.token))
      .set('Idempotency-Key', '3b241101-e2bb-4255-8caf-4136c566a962')
      .send({ listingId: Number(listing.id), quantity: 2 });
    expect(created.status).toBe(201);
    expect(created.body.order.totalAmount).toBe('178.00');
    expect(created.body.order.savingAmount).toBe('322.00');

    const replay = await request(app)
      .post('/api/v1/orders')
      .set(auth(buyer.token))
      .set('Idempotency-Key', '3b241101-e2bb-4255-8caf-4136c566a962')
      .send({ listingId: Number(listing.id), quantity: 2 });
    expect(replay.status).toBe(200);
    expect(replay.body.order.publicId).toBe(created.body.order.publicId);
    expect(
      (await prisma.offerListing.findUniqueOrThrow({ where: { id: listing.id } })).quantityLeft,
    ).toBe(3);

    const paid = await pay(buyer.token, created.body.payment.checkoutUrl);
    expect(paid.body.outcome).toBe('paid');
    expect((await pay(buyer.token, created.body.payment.checkoutUrl)).body.outcome).toBe(
      'already_processed',
    );

    const publicId = created.body.order.publicId as string;
    const voucher = await request(app)
      .get(`/api/v1/orders/${publicId}/voucher`)
      .set(auth(buyer.token));
    expect(voucher.status).toBe(200);
    expect(voucher.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    const base = `/api/v1/partner/venues/${venue.id}`;
    const byCode = await request(app)
      .post(`${base}/pickups/verify`)
      .set(auth(owner.token))
      .send({ code: voucher.body.code.toLowerCase() });
    expect(byCode.status).toBe(200);
    expect(byCode.body.customerName).toBe('Тест К.');

    const byQr = await request(app)
      .post(`${base}/pickups/verify`)
      .set(auth(owner.token))
      .send({ qrToken: voucher.body.qrToken });
    expect(byQr.body.publicId).toBe(publicId);

    const picked = await request(app)
      .post(`${base}/orders/${publicId}/pickup`)
      .set(auth(owner.token));
    expect(picked.status).toBe(200);
    expect(picked.body.status).toBe('picked_up');

    const again = await request(app)
      .post(`${base}/orders/${publicId}/pickup`)
      .set(auth(owner.token));
    expect(again.status).toBe(409);

    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: buyer.user.id } });
    expect(stats.savedCount).toBe(2);
    expect(stats.savedMoney.toFixed(2)).toBe('322.00');
    expect(stats.savedKg.toFixed(2)).toBe('1.60');
  });

  it('returns stock when a reservation expires and accepts a late payment if stock is left', async () => {
    const { listing } = await setup(2);
    const buyer = await createUser();
    const created = await request(app)
      .post('/api/v1/orders')
      .set(auth(buyer.token))
      .send({ listingId: Number(listing.id), quantity: 2 });
    expect(created.status).toBe(201);

    await prisma.order.updateMany({ data: { reservedUntil: new Date(Date.now() - 1000) } });
    expect(await expirePendingOrders()).toBe(1);
    const restored = await prisma.offerListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(restored.quantityLeft).toBe(2);
    expect(restored.status).toBe('on_sale');

    expect((await pay(buyer.token, created.body.payment.checkoutUrl)).body.outcome).toBe('paid');
    expect(
      (await prisma.offerListing.findUniqueOrThrow({ where: { id: listing.id } })).quantityLeft,
    ).toBe(0);
  });

  it('refunds when the customer cancels a paid order before the deadline', async () => {
    const { listing } = await setup(3);
    const buyer = await createUser();
    const created = await request(app)
      .post('/api/v1/orders')
      .set(auth(buyer.token))
      .send({ listingId: Number(listing.id), quantity: 1 });
    await pay(buyer.token, created.body.payment.checkoutUrl);

    const cancelled = await request(app)
      .post(`/api/v1/orders/${created.body.order.publicId}/cancel`)
      .set(auth(buyer.token))
      .send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled_by_customer');
    expect(await prisma.refund.count({ where: { status: 'success' } })).toBe(1);
    expect(
      (await prisma.offerListing.findUniqueOrThrow({ where: { id: listing.id } })).quantityLeft,
    ).toBe(3);
  });

  it('requires a verified email to order', async () => {
    const { listing } = await setup(3);
    const unverified = await createUser({ verified: false });
    const res = await request(app)
      .post('/api/v1/orders')
      .set(auth(unverified.token))
      .send({ listingId: Number(listing.id), quantity: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('hides venues of other partners (TZ 12.2 #6)', async () => {
    const { venue } = await setup(3);
    const stranger = await createUser();
    const res = await request(app)
      .get(`/api/v1/partner/venues/${venue.id}/orders`)
      .set(auth(stranger.token));
    expect(res.status).toBe(404);
  });
});
