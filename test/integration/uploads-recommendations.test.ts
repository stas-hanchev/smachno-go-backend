import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { createDictionaries, createUser, createVenueWithListing, resetDb } from './fixtures.js';

const cloudinary = vi.hoisted(() => ({
  uploaded: [] as string[],
  deleted: [] as (string | null | undefined)[],
}));

vi.mock('../../src/lib/cloudinary.js', () => ({
  cloudinaryEnabled: true,
  uploadImage: async (_buffer: Buffer, options: { folder: string; prefix: string }) => {
    const url = `https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/smachnogo/${options.folder}/${options.prefix}-${cloudinary.uploaded.length + 1}`;
    cloudinary.uploaded.push(url);
    return url;
  },
  deleteImage: async (url: string | null | undefined) => {
    cloudinary.deleted.push(url);
  },
}));

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

async function setup() {
  await resetDb();
  cloudinary.uploaded.length = 0;
  cloudinary.deleted.length = 0;
  const { city, category } = await createDictionaries();
  const owner = await createUser();
  const near = await createVenueWithListing({
    ownerId: owner.user.id,
    cityId: city.id,
    categoryId: category.id,
    slug: 'near',
    lat: 50.4505,
    lng: 30.5235,
    quantity: 5,
  });
  const far = await createVenueWithListing({
    ownerId: owner.user.id,
    cityId: city.id,
    categoryId: category.id,
    slug: 'far',
    lat: 50.47,
    lng: 30.55,
    quantity: 5,
  });
  return { owner, near, far, city, category };
}

describe('photo uploads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces the venue logo and deletes the old file', async () => {
    const { owner, near } = await setup();
    const path = `/api/v1/partner/venues/${near.venue.id}/logo`;

    const first = await request(app)
      .post(path)
      .set(auth(owner.token))
      .attach('file', PNG, 'logo.png');
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(path)
      .set(auth(owner.token))
      .attach('file', PNG, 'logo.png');
    expect(second.status).toBe(200);

    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: near.venue.id } });
    expect(venue.logoUrl).toBe(second.body.url);
    expect(cloudinary.deleted).toEqual([null, first.body.url]);

    const profile = await request(app).get(`/api/v1/venues/${near.venue.slug}`).expect(200);
    expect(profile.body.logoUrl).toBe(second.body.url);
  });

  it('rejects files that are not images and files over 5 MB', async () => {
    const { owner, near } = await setup();
    const path = `/api/v1/partner/venues/${near.venue.id}/cover`;

    const svg = await request(app)
      .post(path)
      .set(auth(owner.token))
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.png');
    expect(svg.status).toBe(400);
    expect(svg.body.error.details[0].field).toBe('file');

    const huge = await request(app)
      .post(path)
      .set(auth(owner.token))
      .attach('file', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png');
    expect(huge.status).toBe(400);

    const missing = await request(app).post(path).set(auth(owner.token));
    expect(missing.status).toBe(400);
    expect(cloudinary.uploaded).toHaveLength(0);
  });

  it('adds and removes gallery photos and sets the offer photo', async () => {
    const { owner, near } = await setup();
    const base = `/api/v1/partner/venues/${near.venue.id}`;

    const added = await request(app)
      .post(`${base}/photos`)
      .set(auth(owner.token))
      .attach('file', PNG, 'a.png');
    expect(added.status).toBe(201);
    expect(added.body).toHaveLength(1);

    const removed = await request(app)
      .delete(`${base}/photos/${added.body[0].id}`)
      .set(auth(owner.token));
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual([]);
    expect(cloudinary.deleted).toContain(added.body[0].url);

    const offer = await request(app)
      .post(`${base}/offers/${near.offer.id}/photo`)
      .set(auth(owner.token))
      .attach('file', PNG, 'offer.png');
    expect(offer.status).toBe(200);
    const listing = await request(app).get(`/api/v1/listings/${near.listing.id}`).expect(200);
    expect(listing.body.offer.photoUrl).toBe(offer.body.url);
  });
});

describe('recommendations', () => {
  const point = { lat: 50.4501, lng: 30.5234 };

  it('returns a ranked, diversified list for guests', async () => {
    const { near, far } = await setup();
    const res = await request(app).get('/api/v1/recommendations').query(point).expect(200);
    expect(res.body.meta.personalized).toBe(false);
    expect(res.body.data.map((l: { id: number }) => l.id)).toEqual([
      Number(near.listing.id),
      Number(far.listing.id),
    ]);

    const daily = await request(app).get('/api/v1/recommendations/daily').query(point).expect(200);
    expect(daily.body.listing.id).toBe(Number(near.listing.id));
  });

  it('returns an empty list when nothing is nearby', async () => {
    await setup();
    const res = await request(app)
      .get('/api/v1/recommendations')
      .query({ lat: 49.99, lng: 36.23, radiusKm: 5 })
      .expect(200);
    expect(res.body.data).toEqual([]);
    const daily = await request(app)
      .get('/api/v1/recommendations/daily')
      .query({ lat: 49.99, lng: 36.23 })
      .expect(200);
    expect(daily.body.listing).toBeNull();
  });

  it('records interactions and personalizes after three signals', async () => {
    const { far } = await setup();
    const customer = await createUser();
    const events = Array.from({ length: 3 }, () => ({
      offerId: Number(far.offer.id),
      type: 'view',
      source: 'search',
    }));

    const guest = await request(app).post('/api/v1/interactions').send({ events });
    expect(guest.status).toBe(400);

    const anon = await request(app)
      .post('/api/v1/interactions')
      .send({ anonId: '01JA0000000000000000000000', events: [{ offerId: 999999, type: 'view' }] });
    expect(anon.status).toBe(202);
    expect(anon.body.accepted).toBe(0);

    const recorded = await request(app)
      .post('/api/v1/interactions')
      .set(auth(customer.token))
      .send({ events });
    expect(recorded.status).toBe(202);
    expect(recorded.body.accepted).toBe(3);

    const res = await request(app)
      .get('/api/v1/recommendations')
      .set(auth(customer.token))
      .query(point)
      .expect(200);
    expect(res.body.meta.personalized).toBe(true);
    const prefs = await prisma.userPreferences.findUniqueOrThrow({
      where: { userId: customer.user.id },
    });
    expect(Object.values(prefs.categoryWeights as Record<string, number>)).toContain(1);
  });
});
