import type { Offer, OfferStatus, Prisma } from '../../generated/prisma/client.js';
import { businessRule, notFound } from '../../lib/errors.js';
import { Decimal, formatMoney, type DecimalValue } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';

export interface OfferInput {
  title: string;
  description?: string | null;
  categoryId: number;
  photoUrl?: string | null;
  originalPrice: number;
  price: number;
  estWeightKg?: number;
  maxPerOrder?: number;
  tagIds?: number[];
  allergenIds?: number[];
}

const offerInclude = {
  category: true,
  tags: { include: { tag: true } },
  allergens: { include: { allergen: true } },
} satisfies Prisma.OfferInclude;

type OfferWithRelations = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

export function toOfferDto(offer: OfferWithRelations) {
  return {
    id: Number(offer.id),
    venueId: Number(offer.venueId),
    title: offer.title,
    description: offer.description,
    photoUrl: offer.photoUrl,
    category: { id: Number(offer.category.id), name: offer.category.name },
    originalPrice: formatMoney(offer.originalPrice),
    price: formatMoney(offer.price),
    estWeightKg: offer.estWeightKg.toNumber(),
    maxPerOrder: offer.maxPerOrder,
    status: offer.status,
    tags: offer.tags.map((t) => ({ id: Number(t.tag.id), name: t.tag.name })),
    allergens: offer.allergens.map((a) => ({ id: Number(a.allergen.id), name: a.allergen.name })),
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
}

export async function assertValidPrice(price: DecimalValue, originalPrice: DecimalValue) {
  const settings = await getSettings();
  const p = new Decimal(price);
  const original = new Decimal(originalPrice);
  if (p.gte(original)) {
    throw businessRule('Ціна зі знижкою має бути меншою за повну ціну', [
      { field: 'price', message: 'Ціна має бути меншою за повну ціну' },
    ]);
  }
  const min = original.times(settings.min_price_ratio).toDecimalPlaces(2, Decimal.ROUND_UP);
  if (p.lt(min)) {
    throw businessRule(`Мінімальна ціна для цього набору: ${min.toFixed(2)} грн`, [
      { field: 'price', message: `Ціна не може бути нижчою за ${min.toFixed(2)} грн` },
    ]);
  }
}

async function assertDictionaryIds(input: Partial<OfferInput>) {
  if (input.categoryId !== undefined) {
    const exists = await prisma.category.count({ where: { id: input.categoryId, isActive: true } });
    if (!exists)
      throw businessRule('Категорію не знайдено', [
        { field: 'categoryId', message: 'Невідома категорія' },
      ]);
  }
  if (input.tagIds?.length) {
    const count = await prisma.tag.count({ where: { id: { in: input.tagIds.map(BigInt) } } });
    if (count !== new Set(input.tagIds).size) {
      throw businessRule('Невідомий дієтичний тег', [
        { field: 'tagIds', message: 'Невідомий тег' },
      ]);
    }
  }
  if (input.allergenIds?.length) {
    const count = await prisma.allergen.count({
      where: { id: { in: input.allergenIds.map(BigInt) } },
    });
    if (count !== new Set(input.allergenIds).size) {
      throw businessRule('Невідомий алерген', [
        { field: 'allergenIds', message: 'Невідомий алерген' },
      ]);
    }
  }
}

export async function listOffers(venueId: bigint, status?: OfferStatus) {
  const offers = await prisma.offer.findMany({
    where: { venueId, ...(status ? { status } : { status: { not: 'archived' } }) },
    include: offerInclude,
    orderBy: { createdAt: 'desc' },
  });
  return offers.map(toOfferDto);
}

async function findOffer(venueId: bigint, offerId: bigint): Promise<Offer> {
  const offer = await prisma.offer.findFirst({ where: { id: offerId, venueId } });
  if (!offer) throw notFound('Набір не знайдено');
  return offer;
}

export async function getOffer(venueId: bigint, offerId: bigint) {
  await findOffer(venueId, offerId);
  return toOfferDto(
    await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, include: offerInclude }),
  );
}

export async function createOffer(venueId: bigint, input: OfferInput) {
  await assertValidPrice(input.price, input.originalPrice);
  await assertDictionaryIds(input);
  const offer = await prisma.offer.create({
    data: {
      venueId,
      title: input.title,
      description: input.description ?? null,
      categoryId: BigInt(input.categoryId),
      photoUrl: input.photoUrl ?? null,
      originalPrice: input.originalPrice,
      price: input.price,
      ...(input.estWeightKg !== undefined && { estWeightKg: input.estWeightKg }),
      ...(input.maxPerOrder !== undefined && { maxPerOrder: input.maxPerOrder }),
      tags: { create: [...new Set(input.tagIds ?? [])].map((tagId) => ({ tagId: BigInt(tagId) })) },
      allergens: {
        create: [...new Set(input.allergenIds ?? [])].map((allergenId) => ({
          allergenId: BigInt(allergenId),
        })),
      },
    },
    include: offerInclude,
  });
  return toOfferDto(offer);
}

export async function updateOffer(
  venueId: bigint,
  offerId: bigint,
  input: Partial<OfferInput> & { status?: 'active' | 'paused' },
) {
  const offer = await findOffer(venueId, offerId);
  if (offer.status === 'archived') throw businessRule('Архівний набір не можна змінювати');
  if (input.price !== undefined || input.originalPrice !== undefined) {
    await assertValidPrice(input.price ?? offer.price, input.originalPrice ?? offer.originalPrice);
  }
  await assertDictionaryIds(input);

  const updated = await prisma.$transaction(async (tx) => {
    if (input.tagIds) {
      await tx.offerTag.deleteMany({ where: { offerId } });
      await tx.offerTag.createMany({
        data: [...new Set(input.tagIds)].map((tagId) => ({ offerId, tagId: BigInt(tagId) })),
      });
    }
    if (input.allergenIds) {
      await tx.offerAllergen.deleteMany({ where: { offerId } });
      await tx.offerAllergen.createMany({
        data: [...new Set(input.allergenIds)].map((allergenId) => ({
          offerId,
          allergenId: BigInt(allergenId),
        })),
      });
    }
    return tx.offer.update({
      where: { id: offerId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.categoryId !== undefined && { categoryId: BigInt(input.categoryId) }),
        ...(input.photoUrl !== undefined && { photoUrl: input.photoUrl }),
        ...(input.originalPrice !== undefined && { originalPrice: input.originalPrice }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.estWeightKg !== undefined && { estWeightKg: input.estWeightKg }),
        ...(input.maxPerOrder !== undefined && { maxPerOrder: input.maxPerOrder }),
        ...(input.status !== undefined && { status: input.status }),
      },
      include: offerInclude,
    });
  });
  return toOfferDto(updated);
}

export async function archiveOffer(venueId: bigint, offerId: bigint) {
  await findOffer(venueId, offerId);
  await prisma.offer.update({ where: { id: offerId }, data: { status: 'archived' } });
}
