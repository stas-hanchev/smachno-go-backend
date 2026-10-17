import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { distanceMeters } from '../../src/lib/geo.js';
import { sentMail } from '../../src/lib/mailer.js';
import { createDictionaries, createUser, createVenueWithListing, resetDb } from './fixtures.js';

const app = createApp();

function tokenFromLastMail(): string {
  const text = sentMail.at(-1)?.text ?? '';
  const match = /token=([^\s&]+)/.exec(text);
  if (!match?.[1]) throw new Error('No token in the last email');
  return decodeURIComponent(match[1]);
}

function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('sg_rt='));
  if (!cookie) throw new Error('No refresh cookie');
  return cookie.split(';')[0]!;
}

describe('auth', () => {
  beforeEach(async () => {
    await resetDb();
    sentMail.length = 0;
  });

  it('registers, verifies email, rotates refresh tokens and detects reuse', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      firstName: 'Олена',
      email: 'Olena@Example.com',
      password: 'secret123',
      acceptTerms: true,
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe('olena@example.com');
    expect(reg.body.user.emailVerified).toBe(false);

    const duplicate = await request(app).post('/api/v1/auth/register').send({
      firstName: 'Олена',
      email: 'olena@example.com',
      password: 'secret123',
      acceptTerms: true,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_TAKEN');

    const verify = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenFromLastMail() });
    expect(verify.status).toBe(204);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'olena@example.com', password: 'secret123' });
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(true);
    const first = refreshCookie(login);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .set('x-sg-csrf', '1');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    const second = refreshCookie(refreshed);

    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .set('x-sg-csrf', '1');
    expect(reuse.status).toBe(401);
    const afterReuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', second)
      .set('x-sg-csrf', '1');
    expect(afterReuse.status).toBe(401);

    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'olena@example.com', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('resets the password with a one-time link', async () => {
    await request(app).post('/api/v1/auth/register').send({
      firstName: 'Іван',
      email: 'ivan@example.com',
      password: 'secret123',
      acceptTerms: true,
    });
    expect(
      (await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ivan@example.com' }))
        .status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'nobody@example.com' })
      ).status,
    ).toBe(204);

    const token = tokenFromLastMail();
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'new-secret-1' });
    expect(reset.status).toBe(204);
    const reused = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'new-secret-2' });
    expect(reused.status).toBe(400);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ivan@example.com', password: 'new-secret-1' });
    expect(login.status).toBe(200);
  });
});

describe('catalog', () => {
  it('finds listings within the radius, sorted by distance', async () => {
    await resetDb();
    const { city, category } = await createDictionaries();
    const owner = await createUser();
    const near = { lat: 50.4475, lng: 30.5222 };
    const mid = { lat: 50.4342, lng: 30.5169 };
    const far = { lat: 50.5122, lng: 30.4986 };
    for (const [slug, p] of [
      ['near', near],
      ['mid', mid],
      ['far', far],
    ] as const) {
      await createVenueWithListing({
        ownerId: owner.user.id,
        cityId: city.id,
        categoryId: category.id,
        slug,
        ...p,
        quantity: 3,
      });
    }

    const res = await request(app)
      .get('/api/v1/listings')
      .query({ lat: near.lat, lng: near.lng, radiusKm: 5, sort: 'distance' });
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.map((l: { venue: { slug: string } }) => l.venue.slug)).toEqual([
      'near',
      'mid',
    ]);

    const midDistance = res.body.data[1].distanceM as number;
    expect(Math.abs(midDistance - distanceMeters(near, mid))).toBeLessThan(2);
    expect(res.body.data[0].discountPercent).toBe(64);
    expect(res.body.data[0].price).toBe('89.00');

    const wide = await request(app)
      .get('/api/v1/listings')
      .query({ lat: near.lat, lng: near.lng, radiusKm: 10 });
    expect(wide.body.meta.total).toBe(3);

    const venuePage = await request(app).get('/api/v1/venues/near');
    expect(venuePage.status).toBe(200);
    expect(venuePage.body.isNew).toBe(true);
    expect(venuePage.body.hours).toHaveLength(7);
  });
});
