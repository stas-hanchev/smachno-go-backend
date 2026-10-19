import { randomUUID } from 'node:crypto';
import { encrypt } from '../../src/lib/crypto.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetSettingsCache } from '../../src/lib/settings.js';
import { addMinutes, dateOnlyToDb, kyivDate, timeToDb } from '../../src/lib/time.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';

const TABLES = [
  'settlement_items',
  'settlements',
  'refunds',
  'payments',
  'payment_webhook_log',
  'order_status_history',
  'reviews',
  'orders',
  'interactions',
  'favorites',
  'offer_schedules',
  'offer_tags',
  'offer_allergens',
  'offer_listings',
  'offers',
  'venue_photos',
  'venue_closures',
  'venue_hours',
  'venue_members',
  'venues',
  'partner_applications',
  'user_achievements',
  'user_stats',
  'user_preferences',
  'notification_settings',
  'push_subscriptions',
  'notifications',
  'refresh_tokens',
  'auth_tokens',
  'oauth_accounts',
  'audit_log',
  'settings',
  'users',
  'categories',
  'cities',
  'tags',
  'allergens',
  'levels',
  'achievements',
];

export async function resetDb() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  });
  resetSettingsCache();
}

export async function createUser(
  opts: { verified?: boolean; email?: string; role?: 'customer' | 'admin' | 'super_admin' } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `user-${randomUUID()}@test.local`,
      firstName: 'Тест',
      lastName: 'Користувач',
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      role: opts.role ?? 'customer',
    },
  });
  return { user, token: signAccessToken(user.id, user.role) };
}

export async function createDictionaries() {
  const city = await prisma.city.create({
    data: { name: 'Київ', slug: 'kyiv', centerLat: 50.4501, centerLng: 30.5234 },
  });
  const category = await prisma.category.create({ data: { name: 'Випічка', slug: 'bakery' } });
  return { city, category };
}

export async function createVenueWithListing(opts: {
  ownerId: bigint;
  cityId: bigint;
  categoryId: bigint;
  slug: string;
  lat: number;
  lng: number;
  quantity: number;
  maxPerOrder?: number;
}) {
  const venue = await prisma.venue.create({
    data: {
      slug: opts.slug,
      name: `Заклад ${opts.slug}`,
      categoryId: opts.categoryId,
      cityId: opts.cityId,
      address: 'вул. Тестова, 1',
      lat: opts.lat,
      lng: opts.lng,
      legalName: 'ФОП Тест',
      taxId: encrypt('1234567890'),
      iban: encrypt('UA213223130000026007233566001'),
      status: 'active',
      members: { create: { userId: opts.ownerId, role: 'owner', status: 'active' } },
      hours: {
        create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          opensAt: timeToDb('00:00'),
          closesAt: timeToDb('23:59'),
        })),
      },
    },
  });
  const offer = await prisma.offer.create({
    data: {
      venueId: venue.id,
      title: 'Сюрприз-бокс',
      categoryId: opts.categoryId,
      originalPrice: 250,
      price: 89,
      estWeightKg: 0.8,
      maxPerOrder: opts.maxPerOrder ?? 2,
    },
  });
  const now = new Date();
  const listing = await prisma.offerListing.create({
    data: {
      offerId: offer.id,
      venueId: venue.id,
      pickupDate: dateOnlyToDb(kyivDate(now)),
      pickupStart: addMinutes(now, 180),
      pickupEnd: addMinutes(now, 300),
      price: 89,
      originalPrice: 250,
      quantityTotal: opts.quantity,
      quantityLeft: opts.quantity,
      status: 'on_sale',
      source: 'manual',
    },
  });
  return { venue, offer, listing };
}
