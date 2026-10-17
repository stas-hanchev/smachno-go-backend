import bcrypt from 'bcryptjs';
import { encrypt } from '../src/lib/crypto.js';
import { prisma } from '../src/lib/prisma.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { addDays, dateOnlyToDb, kyivDate, kyivToUtc, timeToDb } from '../src/lib/time.js';

const cities = [
  { slug: 'kyiv', name: 'Київ', centerLat: 50.4501, centerLng: 30.5234 },
  { slug: 'kharkiv', name: 'Харків', centerLat: 49.9935, centerLng: 36.2304 },
];

const categories = [
  { slug: 'bakery', name: 'Випічка', icon: 'bakery', sortOrder: 1 },
  { slug: 'ready-meals', name: 'Готові страви', icon: 'meal', sortOrder: 2 },
  { slug: 'coffee-desserts', name: 'Кава й десерти', icon: 'coffee', sortOrder: 3 },
  { slug: 'groceries', name: 'Продукти', icon: 'grocery', sortOrder: 4 },
  { slug: 'sushi', name: 'Суші', icon: 'sushi', sortOrder: 5 },
  { slug: 'pizza', name: 'Піца', icon: 'pizza', sortOrder: 6 },
];

const tags = [
  { slug: 'vegetarian', name: 'Вегетаріанське' },
  { slug: 'vegan', name: 'Веганське' },
  { slug: 'gluten-free', name: 'Без глютену' },
  { slug: 'lactose-free', name: 'Без лактози' },
  { slug: 'halal', name: 'Халяль' },
];

const allergens = [
  { slug: 'gluten', name: 'Злаки з глютеном' },
  { slug: 'crustaceans', name: 'Ракоподібні' },
  { slug: 'eggs', name: 'Яйця' },
  { slug: 'fish', name: 'Риба' },
  { slug: 'peanuts', name: 'Арахіс' },
  { slug: 'soy', name: 'Соя' },
  { slug: 'milk', name: 'Молоко' },
  { slug: 'nuts', name: 'Горіхи' },
  { slug: 'celery', name: 'Селера' },
  { slug: 'mustard', name: 'Гірчиця' },
  { slug: 'sesame', name: 'Кунжут' },
  { slug: 'sulphites', name: 'Діоксид сірки та сульфіти' },
  { slug: 'lupin', name: 'Люпин' },
  { slug: 'molluscs', name: 'Молюски' },
];

const levels = [
  { name: 'Новачок', minSavedCount: 0, sortOrder: 1 },
  { name: 'Рятівник', minSavedCount: 5, sortOrder: 2 },
  { name: 'Еко-герой', minSavedCount: 20, sortOrder: 3 },
  { name: 'Легенда', minSavedCount: 50, sortOrder: 4 },
];

const achievements = [
  {
    code: 'first_order',
    name: 'Перше замовлення',
    description: 'Заберіть перший набір',
    icon: 'star',
    rule: { type: 'saved_count', threshold: 1 },
  },
  {
    code: 'five_venues',
    name: 'Дослідник',
    description: 'Замовте в 5 різних закладах',
    icon: 'map',
    rule: { type: 'distinct_venues', threshold: 5 },
  },
  {
    code: 'ten_kg',
    name: '10 кг врятовано',
    description: 'Врятуйте 10 кг їжі',
    icon: 'leaf',
    rule: { type: 'saved_kg', threshold: 10 },
  },
];

interface DemoOffer {
  title: string;
  description: string;
  category: string;
  originalPrice: number;
  price: number;
  estWeightKg: number;
  tags: string[];
  allergens: string[];
  window: [string, string];
  quantity: number;
}

interface DemoVenue {
  slug: string;
  name: string;
  city: string;
  category: string;
  address: string;
  lat: number;
  lng: number;
  description: string;
  hours: [string, string];
  offers: DemoOffer[];
}

const demoVenues: DemoVenue[] = [
  {
    slug: 'ecofood-cafe',
    name: 'EcoFood Cafe',
    city: 'kyiv',
    category: 'coffee-desserts',
    address: 'вул. Хрещатик, 22',
    lat: 50.4475,
    lng: 30.5222,
    description: "Кав'ярня з власною пекарнею та сезонним меню.",
    hours: ['08:00', '22:00'],
    offers: [
      {
        title: 'Сюрприз-бокс випічки',
        description: 'Круасани, булочки та десерт дня',
        category: 'bakery',
        originalPrice: 250,
        price: 89,
        estWeightKg: 0.8,
        tags: ['vegetarian'],
        allergens: ['gluten', 'milk', 'eggs'],
        window: ['19:00', '21:00'],
        quantity: 5,
      },
      {
        title: 'Десертний набір',
        description: 'Тістечка й чизкейк',
        category: 'coffee-desserts',
        originalPrice: 320,
        price: 129,
        estWeightKg: 0.6,
        tags: ['vegetarian'],
        allergens: ['gluten', 'milk', 'eggs', 'nuts'],
        window: ['20:00', '21:30'],
        quantity: 3,
      },
    ],
  },
  {
    slug: 'khlib-i-sil',
    name: 'Хліб і Сіль',
    city: 'kyiv',
    category: 'bakery',
    address: 'вул. Велика Васильківська, 45',
    lat: 50.4342,
    lng: 30.5169,
    description: 'Ремісничий хліб на заквасці.',
    hours: ['07:00', '21:00'],
    offers: [
      {
        title: 'Хлібний кошик',
        description: 'Два-три види хліба на заквасці',
        category: 'bakery',
        originalPrice: 180,
        price: 69,
        estWeightKg: 1.2,
        tags: ['vegan'],
        allergens: ['gluten'],
        window: ['18:30', '20:30'],
        quantity: 8,
      },
    ],
  },
  {
    slug: 'sushi-wave-podil',
    name: 'Sushi Wave',
    city: 'kyiv',
    category: 'sushi',
    address: 'вул. Сагайдачного, 10',
    lat: 50.4634,
    lng: 30.5185,
    description: 'Роли та боули на Подолі.',
    hours: ['11:00', '23:00'],
    offers: [
      {
        title: 'Сет ролів дня',
        description: 'Асорті ролів, приготованих сьогодні',
        category: 'sushi',
        originalPrice: 480,
        price: 199,
        estWeightKg: 0.7,
        tags: [],
        allergens: ['fish', 'soy', 'sesame'],
        window: ['21:30', '22:45'],
        quantity: 4,
      },
    ],
  },
  {
    slug: 'kharkiv-kitchen',
    name: 'Kharkiv Kitchen',
    city: 'kharkiv',
    category: 'ready-meals',
    address: 'вул. Сумська, 30',
    lat: 50.0035,
    lng: 36.2346,
    description: 'Домашні обіди та вечері.',
    hours: ['09:00', '21:00'],
    offers: [
      {
        title: 'Обід дня',
        description: 'Перша й друга страва, салат',
        category: 'ready-meals',
        originalPrice: 220,
        price: 89,
        estWeightKg: 0.9,
        tags: [],
        allergens: ['gluten', 'celery'],
        window: ['19:00', '20:45'],
        quantity: 6,
      },
    ],
  },
  {
    slug: 'pizza-point-kharkiv',
    name: 'Pizza Point',
    city: 'kharkiv',
    category: 'pizza',
    address: 'пр. Науки, 14',
    lat: 50.0122,
    lng: 36.2276,
    description: 'Неаполітанська піца з печі.',
    hours: ['10:00', '23:00'],
    offers: [
      {
        title: 'Піца-сюрприз',
        description: 'Дві піци 30 см на вибір шефа',
        category: 'pizza',
        originalPrice: 420,
        price: 159,
        estWeightKg: 1.1,
        tags: ['vegetarian'],
        allergens: ['gluten', 'milk'],
        window: ['21:00', '22:45'],
        quantity: 4,
      },
    ],
  },
];

async function seedDictionaries() {
  for (const city of cities) {
    await prisma.city.upsert({
      where: { slug: city.slug },
      update: { name: city.name },
      create: city,
    });
  }
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: category,
      create: category,
    });
  }
  for (const tag of tags) {
    await prisma.tag.upsert({ where: { slug: tag.slug }, update: tag, create: tag });
  }
  for (const allergen of allergens) {
    await prisma.allergen.upsert({
      where: { slug: allergen.slug },
      update: allergen,
      create: allergen,
    });
  }
  if ((await prisma.level.count()) === 0) await prisma.level.createMany({ data: levels });
  for (const a of achievements) {
    await prisma.achievement.upsert({ where: { code: a.code }, update: {}, create: a });
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
}

async function seedUser(
  email: string,
  password: string,
  firstName: string,
  role: 'customer' | 'super_admin',
) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      firstName,
      role,
      emailVerifiedAt: new Date(),
      passwordHash: await bcrypt.hash(password, 10),
      notificationSettings: { create: {} },
      stats: { create: {} },
    },
  });
}

async function seedDemoVenues(ownerId: bigint) {
  const today = kyivDate();
  const dates = [today, addDays(today, 1)];

  for (const demo of demoVenues) {
    if (await prisma.venue.findUnique({ where: { slug: demo.slug } })) continue;
    const city = await prisma.city.findUniqueOrThrow({ where: { slug: demo.city } });
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: demo.category } });

    const venue = await prisma.venue.create({
      data: {
        slug: demo.slug,
        name: demo.name,
        description: demo.description,
        categoryId: category.id,
        cityId: city.id,
        address: demo.address,
        lat: demo.lat,
        lng: demo.lng,
        legalName: `ФОП ${demo.name}`,
        taxId: encrypt('1234567890'),
        iban: encrypt('UA213223130000026007233566001'),
        status: 'active',
        members: { create: { userId: ownerId, role: 'owner', status: 'active' } },
        hours: {
          create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
            weekday,
            opensAt: timeToDb(demo.hours[0]),
            closesAt: timeToDb(demo.hours[1]),
          })),
        },
      },
    });

    for (const o of demo.offers) {
      const offerCategory = await prisma.category.findUniqueOrThrow({
        where: { slug: o.category },
      });
      const tagRows = await prisma.tag.findMany({ where: { slug: { in: o.tags } } });
      const allergenRows = await prisma.allergen.findMany({ where: { slug: { in: o.allergens } } });
      const offer = await prisma.offer.create({
        data: {
          venueId: venue.id,
          title: o.title,
          description: o.description,
          categoryId: offerCategory.id,
          originalPrice: o.originalPrice,
          price: o.price,
          estWeightKg: o.estWeightKg,
          tags: { create: tagRows.map((t) => ({ tagId: t.id })) },
          allergens: { create: allergenRows.map((a) => ({ allergenId: a.id })) },
        },
      });
      for (const date of dates) {
        const pickupEnd = kyivToUtc(date, o.window[1]);
        await prisma.offerListing.create({
          data: {
            offerId: offer.id,
            venueId: venue.id,
            pickupDate: dateOnlyToDb(date),
            pickupStart: kyivToUtc(date, o.window[0]),
            pickupEnd,
            price: o.price,
            originalPrice: o.originalPrice,
            quantityTotal: o.quantity,
            quantityLeft: o.quantity,
            status: pickupEnd.getTime() - 15 * 60_000 > Date.now() ? 'on_sale' : 'closed',
            source: 'manual',
          },
        });
      }
    }
    console.log(`Seeded venue ${demo.name}`);
  }
}

async function main() {
  await seedDictionaries();
  const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@smachnogo.local';
  const adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'Admin12345!';
  await seedUser(adminEmail, adminPassword, 'Адміністратор', 'super_admin');

  if (process.env.NODE_ENV !== 'production') {
    const owner = await seedUser('partner@smachnogo.local', 'Partner12345!', 'Партнер', 'customer');
    await seedUser('customer@smachnogo.local', 'Customer12345!', 'Олена', 'customer');
    await seedDemoVenues(owner.id);
  }
  console.log('Seed completed');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
