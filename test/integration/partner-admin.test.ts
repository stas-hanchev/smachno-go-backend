import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { sentMail } from '../../src/lib/mailer.js';
import { prisma } from '../../src/lib/prisma.js';
import { emittedEvents } from '../../src/lib/realtime.js';
import { addDays, kyivDate } from '../../src/lib/time.js';
import { createDictionaries, createUser, createVenueWithListing, resetDb } from './fixtures.js';

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const ULID = '01JA0000000000000000000000';

function tokenFromLastMail(): string {
  const match = /token=([^\s&]+)/.exec(sentMail.at(-1)?.text ?? '');
  if (!match?.[1]) throw new Error('No token in the last email');
  return decodeURIComponent(match[1]);
}

async function twoVenues() {
  await resetDb();
  sentMail.length = 0;
  emittedEvents.length = 0;
  const { city, category } = await createDictionaries();
  const ownerA = await createUser();
  const ownerB = await createUser();
  const a = await createVenueWithListing({
    ownerId: ownerA.user.id,
    cityId: city.id,
    categoryId: category.id,
    slug: 'venue-a',
    lat: 50.45,
    lng: 30.52,
    quantity: 3,
  });
  const b = await createVenueWithListing({
    ownerId: ownerB.user.id,
    cityId: city.id,
    categoryId: category.id,
    slug: 'venue-b',
    lat: 50.46,
    lng: 30.53,
    quantity: 3,
  });
  const staffB = await createUser();
  await prisma.venueMember.create({
    data: { venueId: b.venue.id, userId: staffB.user.id, role: 'staff', status: 'active' },
  });
  return { city, category, ownerA, ownerB, a, b, staffB };
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface PartnerRoute {
  method: Method;
  path: string;
  body?: object;
  ownerOnly?: boolean;
}

const sevenDays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  opensAt: '08:00',
  closesAt: '22:00',
}));

function partnerRoutes(): PartnerRoute[] {
  const tomorrow = addDays(kyivDate(), 1);
  return [
    { method: 'get', path: '' },
    { method: 'patch', path: '', body: { name: 'Нова назва' }, ownerOnly: true },
    { method: 'put', path: '/hours', body: { hours: sevenDays }, ownerOnly: true },
    { method: 'post', path: '/closures', body: { date: tomorrow }, ownerOnly: true },
    { method: 'delete', path: '/closures/1', ownerOnly: true },
    { method: 'post', path: '/activate', ownerOnly: true },
    { method: 'get', path: '/members', ownerOnly: true },
    {
      method: 'post',
      path: '/members/invite',
      body: { email: 'new@test.local' },
      ownerOnly: true,
    },
    { method: 'delete', path: '/invites/1', ownerOnly: true },
    { method: 'patch', path: '/members/1', body: { status: 'disabled' }, ownerOnly: true },
    { method: 'delete', path: '/members/1', ownerOnly: true },
    { method: 'get', path: '/offers' },
    {
      method: 'post',
      path: '/offers',
      body: { title: 'Набір', categoryId: 1, originalPrice: 100, price: 50 },
      ownerOnly: true,
    },
    { method: 'get', path: '/offers/1' },
    { method: 'patch', path: '/offers/1', body: { title: 'Новий набір' }, ownerOnly: true },
    { method: 'delete', path: '/offers/1', ownerOnly: true },
    { method: 'get', path: '/listings' },
    {
      method: 'post',
      path: '/listings',
      body: { offerId: 1, date: tomorrow, pickupStart: '10:00', pickupEnd: '11:00', quantity: 1 },
    },
    { method: 'patch', path: '/listings/1', body: { quantityTotal: 5 } },
    { method: 'post', path: '/listings/1/close' },
    { method: 'post', path: '/listings/1/cancel', body: { reason: 'Причина' }, ownerOnly: true },
    { method: 'get', path: '/orders' },
    { method: 'post', path: '/pickups/verify', body: { code: 'ABCDEF' } },
    { method: 'post', path: `/orders/${ULID}/pickup` },
    {
      method: 'post',
      path: `/orders/${ULID}/cancel`,
      body: { reason: 'Причина' },
      ownerOnly: true,
    },
  ];
}

function call(route: PartnerRoute, venueId: bigint, token: string) {
  const agent = request(app);
  const req = agent[route.method](`/api/v1/partner/venues/${venueId}${route.path}`).set(
    auth(token),
  );
  return route.body ? req.send(route.body) : req;
}

describe('partner access (TZ 12.2 #6)', () => {
  it('hides every venue route from strangers and from staff of another venue', async () => {
    const { a, ownerB, staffB } = await twoVenues();
    const stranger = await createUser();
    for (const token of [stranger.token, ownerB.token, staffB.token]) {
      for (const route of partnerRoutes()) {
        const res = await call(route, a.venue.id, token);
        expect(`${route.method} ${route.path} ${res.status}`).toBe(
          `${route.method} ${route.path} 404`,
        );
      }
    }
    const untouched = await prisma.venue.findUniqueOrThrow({ where: { id: a.venue.id } });
    expect(untouched.name).toBe('Заклад venue-a');
  });

  it('forbids owner-only routes for staff of the same venue', async () => {
    const { b, staffB } = await twoVenues();
    for (const route of partnerRoutes().filter((r) => r.ownerOnly)) {
      const res = await call(route, b.venue.id, staffB.token);
      expect(`${route.method} ${route.path} ${res.status}`).toBe(
        `${route.method} ${route.path} 403`,
      );
    }
  });
});

describe('venue onboarding', () => {
  beforeEach(async () => {
    await resetDb();
    sentMail.length = 0;
    emittedEvents.length = 0;
  });

  it('goes from application to an active venue', async () => {
    const { city, category } = await createDictionaries();
    const applicant = await createUser();
    const admin = await createUser({ role: 'admin' });

    const application = {
      businessName: 'Пекарня Добра',
      venueType: 'bakery',
      contactName: 'Ірина',
      contactPhone: '+380501234567',
      contactEmail: 'irina@example.com',
      address: 'вул. Хрещатик, 1',
      legalName: 'ФОП Іванова І. І.',
      taxId: '1234567890',
      iban: 'UA21 3223 1300 0002 6007 2335 6600 1',
    };
    const submitted = await request(app)
      .post('/api/v1/partner/applications')
      .set(auth(applicant.token))
      .send(application);
    expect(submitted.status).toBe(201);
    expect(submitted.body.taxId).toBe('••••••7890');
    expect(emittedEvents.some((e) => e.room === 'admin' && e.event === 'application:new')).toBe(
      true,
    );

    const duplicate = await request(app)
      .post('/api/v1/partner/applications')
      .set(auth(applicant.token))
      .send(application);
    expect(duplicate.status).toBe(409);

    const forbidden = await request(app)
      .get('/api/v1/admin/applications')
      .set(auth(applicant.token));
    expect(forbidden.status).toBe(403);

    const detail = await request(app)
      .get(`/api/v1/admin/applications/${submitted.body.id}`)
      .set(auth(admin.token));
    expect(detail.body.iban).toBe('UA213223130000026007233566001');

    const approved = await request(app)
      .post(`/api/v1/admin/applications/${submitted.body.id}/approve`)
      .set(auth(admin.token))
      .send({ categoryId: Number(category.id), cityId: Number(city.id) });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('draft');
    expect(approved.body.slug).toBe('pekarnia-dobra');
    expect(approved.body.phone).toBe('+380501234567');
    expect(sentMail.at(-1)?.subject).toBe('Вашу заявку в СмачноGo схвалено');

    const again = await request(app)
      .post(`/api/v1/admin/applications/${submitted.body.id}/approve`)
      .set(auth(admin.token))
      .send({ categoryId: Number(category.id), cityId: Number(city.id) });
    expect(again.status).toBe(409);

    const venueId = approved.body.id as number;
    const base = `/api/v1/partner/venues/${venueId}`;
    const notReady = await request(app).post(`${base}/activate`).set(auth(applicant.token));
    expect(notReady.status).toBe(422);
    expect(notReady.body.error.details).toEqual([
      { field: 'hours', message: 'Заповніть графік роботи' },
    ]);

    const hours = await request(app)
      .put(`${base}/hours`)
      .set(auth(applicant.token))
      .send({
        hours: sevenDays.map((d) => (d.weekday === 7 ? { weekday: 7, isClosed: true } : d)),
      });
    expect(hours.status).toBe(200);
    expect(hours.body.activation.ready).toBe(true);

    const closure = await request(app)
      .post(`${base}/closures`)
      .set(auth(applicant.token))
      .send({ date: addDays(kyivDate(), 3), reason: 'Санітарний день' });
    expect(closure.status).toBe(201);

    const active = await request(app).post(`${base}/activate`).set(auth(applicant.token));
    expect(active.status).toBe(200);
    expect(active.body.status).toBe('active');
    expect(active.body.closures).toHaveLength(1);

    const audit = await request(app)
      .get('/api/v1/admin/audit-log')
      .query({ entityType: 'partner_application' })
      .set(auth(admin.token));
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual([
      'application.approve',
    ]);
  });

  it('invites staff by email and lets the owner disable them', async () => {
    const { city, category } = await createDictionaries();
    const owner = await createUser();
    const { venue } = await createVenueWithListing({
      ownerId: owner.user.id,
      cityId: city.id,
      categoryId: category.id,
      slug: 'team-cafe',
      lat: 50.45,
      lng: 30.52,
      quantity: 3,
    });
    const base = `/api/v1/partner/venues/${venue.id}`;

    const invite = await request(app)
      .post(`${base}/members/invite`)
      .set(auth(owner.token))
      .send({ email: 'Barista@Example.com' });
    expect(invite.status).toBe(201);
    const token = tokenFromLastMail();

    const someoneElse = await createUser();
    const wrong = await request(app)
      .post('/api/v1/partner/invites/accept')
      .set(auth(someoneElse.token))
      .send({ token });
    expect(wrong.status).toBe(403);

    const staff = await createUser({ email: 'barista@example.com', verified: false });
    const accepted = await request(app)
      .post('/api/v1/partner/invites/accept')
      .set(auth(staff.token))
      .send({ token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe('staff');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: staff.user.id } })).emailVerifiedAt,
    ).not.toBeNull();

    const reused = await request(app)
      .post('/api/v1/partner/invites/accept')
      .set(auth(staff.token))
      .send({ token });
    expect(reused.status).toBe(400);

    expect((await request(app).get(`${base}/orders`).set(auth(staff.token))).status).toBe(200);

    const team = await request(app).get(`${base}/members`).set(auth(owner.token));
    expect(team.body.members.map((m: { role: string }) => m.role)).toEqual(['owner', 'staff']);
    expect(team.body.invites).toEqual([]);

    const self = await request(app)
      .patch(`${base}/members/${owner.user.id}`)
      .set(auth(owner.token))
      .send({ status: 'disabled' });
    expect(self.status).toBe(422);

    const disabled = await request(app)
      .patch(`${base}/members/${staff.user.id}`)
      .set(auth(owner.token))
      .send({ status: 'disabled' });
    expect(disabled.status).toBe(200);
    expect((await request(app).get(`${base}/orders`).set(auth(staff.token))).status).toBe(404);
  });
});

describe('admin', () => {
  beforeEach(async () => {
    await resetDb();
    sentMail.length = 0;
  });

  it('lets only a super admin manage admins and audits every change', async () => {
    const admin = await createUser({ role: 'admin' });
    const superAdmin = await createUser({ role: 'super_admin' });
    const customer = await createUser();

    const promote = await request(app)
      .patch(`/api/v1/admin/users/${customer.user.id}`)
      .set(auth(admin.token))
      .send({ role: 'admin' });
    expect(promote.status).toBe(403);

    const demote = await request(app)
      .patch(`/api/v1/admin/users/${superAdmin.user.id}`)
      .set(auth(admin.token))
      .send({ status: 'blocked' });
    expect(demote.status).toBe(403);

    const self = await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}`)
      .set(auth(admin.token))
      .send({ status: 'blocked' });
    expect(self.status).toBe(422);

    const blocked = await request(app)
      .patch(`/api/v1/admin/users/${customer.user.id}`)
      .set(auth(admin.token))
      .send({ status: 'blocked' });
    expect(blocked.status).toBe(200);
    const me = await request(app).get('/api/v1/me').set(auth(customer.token));
    expect(me.body.error.code).toBe('ACCOUNT_BLOCKED');

    const promoted = await request(app)
      .patch(`/api/v1/admin/users/${customer.user.id}`)
      .set(auth(superAdmin.token))
      .send({ role: 'admin', status: 'active' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe('admin');

    const log = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(log.map((e) => [e.action, Number(e.actorId)])).toEqual([
      ['user.update', Number(admin.user.id)],
      ['user.update', Number(superAdmin.user.id)],
    ]);
  });

  it('refunds an order manually, manages dictionaries and settings', async () => {
    const { city, category } = await createDictionaries();
    const owner = await createUser();
    const admin = await createUser({ role: 'admin' });
    const { listing } = await createVenueWithListing({
      ownerId: owner.user.id,
      cityId: city.id,
      categoryId: category.id,
      slug: 'refund-cafe',
      lat: 50.45,
      lng: 30.52,
      quantity: 3,
    });
    const buyer = await createUser();
    const created = await request(app)
      .post('/api/v1/orders')
      .set(auth(buyer.token))
      .send({ listingId: Number(listing.id), quantity: 1 });
    await request(app).post(created.body.payment.checkoutUrl).set(auth(buyer.token)).send({});
    const publicId = created.body.order.publicId as string;

    const voucher = await request(app)
      .get(`/api/v1/orders/${publicId}/voucher`)
      .set(auth(buyer.token));
    const found = await request(app)
      .get('/api/v1/admin/orders')
      .query({ q: voucher.body.code })
      .set(auth(admin.token));
    expect(found.body.data.map((o: { publicId: string }) => o.publicId)).toEqual([publicId]);

    const refund = await request(app)
      .post(`/api/v1/admin/orders/${publicId}/refund`)
      .set(auth(admin.token))
      .send({ reason: 'Скарга на якість' });
    expect(refund.status).toBe(200);
    expect(refund.body.status).toBe('refunded');
    expect(refund.body.payments[0].status).toBe('reversed');
    expect(refund.body.payments[0].refunds[0]).toMatchObject({
      initiatedBy: 'admin',
      status: 'success',
    });
    expect(
      (await prisma.offerListing.findUniqueOrThrow({ where: { id: listing.id } })).quantityLeft,
    ).toBe(3);
    expect(sentMail.at(-1)?.subject).toBe('Повернення коштів: Сюрприз-бокс');

    const twice = await request(app)
      .post(`/api/v1/admin/orders/${publicId}/refund`)
      .set(auth(admin.token))
      .send({ reason: 'Ще раз' });
    expect(twice.status).toBe(409);

    const dup = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(admin.token))
      .send({ name: 'Випічка', slug: 'bakery' });
    expect(dup.status).toBe(409);
    const used = await request(app)
      .delete(`/api/v1/admin/categories/${category.id}`)
      .set(auth(admin.token));
    expect(used.status).toBe(422);
    const tag = await request(app)
      .post('/api/v1/admin/tags')
      .set(auth(admin.token))
      .send({ name: 'Веганське', slug: 'vegan' });
    expect(tag.status).toBe(201);

    const settings = await request(app)
      .put('/api/v1/admin/settings')
      .set(auth(admin.token))
      .send({ reservation_ttl_min: 15 });
    expect(settings.status).toBe(200);
    expect(settings.body.reservation_ttl_min).toBe(15);
    const invalid = await request(app)
      .put('/api/v1/admin/settings')
      .set(auth(admin.token))
      .send({ reservation_ttl_min: 1 });
    expect(invalid.status).toBe(400);
  });
});

describe('favorites', () => {
  it('adds a venue to favorites and marks its listings', async () => {
    const { a, b } = await twoVenues();
    const user = await createUser();
    expect(
      (await request(app).put(`/api/v1/favorites/${a.venue.id}`).set(auth(user.token)).send({}))
        .status,
    ).toBe(204);
    expect(
      (await request(app).put(`/api/v1/favorites/${a.venue.id}`).set(auth(user.token)).send({}))
        .status,
    ).toBe(204);
    expect((await request(app).put('/api/v1/favorites/999999').set(auth(user.token))).status).toBe(
      404,
    );

    const list = await request(app).get('/api/v1/favorites').set(auth(user.token));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].venue.slug).toBe('venue-a');
    expect(list.body[0].activeListings).toBe(1);

    const search = await request(app)
      .get('/api/v1/listings')
      .query({ lat: 50.45, lng: 30.52, radiusKm: 10 })
      .set(auth(user.token));
    const flags = Object.fromEntries(
      search.body.data.map((l: { venue: { slug: string }; isFavoriteVenue: boolean }) => [
        l.venue.slug,
        l.isFavoriteVenue,
      ]),
    );
    expect(flags).toEqual({ 'venue-a': true, 'venue-b': false });

    expect(
      (await request(app).delete(`/api/v1/favorites/${a.venue.id}`).set(auth(user.token))).status,
    ).toBe(204);
    expect((await request(app).get('/api/v1/favorites').set(auth(user.token))).body).toEqual([]);
    expect(b.venue.id).toBeTruthy();
  });
});
