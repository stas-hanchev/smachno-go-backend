import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getSettings, resetSettingsCache, type BusinessSettings } from '../../lib/settings.js';
import type { AdminActor, Page } from './admin-partners.service.js';

export type DictionaryName = 'categories' | 'tags' | 'allergens' | 'cities';

export interface DictionaryInput {
  name?: string;
  slug?: string;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  centerLat?: number;
  centerLng?: number;
}

interface DictionaryRow {
  id: bigint;
  name: string;
  slug: string;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  centerLat?: Prisma.Decimal;
  centerLng?: Prisma.Decimal;
}

function toDictionaryDto(row: DictionaryRow) {
  return {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    ...(row.icon !== undefined && { icon: row.icon }),
    ...(row.sortOrder !== undefined && { sortOrder: row.sortOrder }),
    ...(row.isActive !== undefined && { isActive: row.isActive }),
    ...(row.centerLat !== undefined && { centerLat: row.centerLat.toNumber() }),
    ...(row.centerLng !== undefined && { centerLng: row.centerLng.toNumber() }),
  };
}

const pick = (input: DictionaryInput, keys: (keyof DictionaryInput)[]) =>
  Object.fromEntries(keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));

const FIELDS: Record<DictionaryName, (keyof DictionaryInput)[]> = {
  categories: ['name', 'slug', 'icon', 'sortOrder', 'isActive'],
  tags: ['name', 'slug'],
  allergens: ['name', 'slug'],
  cities: ['name', 'slug', 'centerLat', 'centerLng', 'isActive'],
};

export async function listDictionary(name: DictionaryName) {
  const rows: DictionaryRow[] =
    name === 'categories'
      ? await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
      : name === 'tags'
        ? await prisma.tag.findMany({ orderBy: { name: 'asc' } })
        : name === 'allergens'
          ? await prisma.allergen.findMany({ orderBy: { name: 'asc' } })
          : await prisma.city.findMany({ orderBy: { name: 'asc' } });
  return rows.map(toDictionaryDto);
}

export async function createDictionaryItem(
  name: DictionaryName,
  input: DictionaryInput,
  actor: AdminActor,
) {
  const data = pick(input, FIELDS[name]) as unknown as {
    name: string;
    slug: string;
  } & DictionaryInput;
  const row: DictionaryRow = await prisma.$transaction(async (tx) => {
    const created: DictionaryRow =
      name === 'categories'
        ? await tx.category.create({ data })
        : name === 'tags'
          ? await tx.tag.create({ data: { name: data.name, slug: data.slug } })
          : name === 'allergens'
            ? await tx.allergen.create({ data: { name: data.name, slug: data.slug } })
            : await tx.city.create({
                data: data as Prisma.CityCreateInput,
              });
    await audit(
      {
        actorId: actor.id,
        action: `${name}.create`,
        entityType: name,
        entityId: created.id,
        diff: data as unknown as Prisma.InputJsonObject,
        ip: actor.ip,
      },
      tx,
    );
    return created;
  });
  return toDictionaryDto(row);
}

export async function updateDictionaryItem(
  name: DictionaryName,
  id: bigint,
  input: DictionaryInput,
  actor: AdminActor,
) {
  const data = pick(input, FIELDS[name]);
  const row: DictionaryRow = await prisma.$transaction(async (tx) => {
    const updated: DictionaryRow =
      name === 'categories'
        ? await tx.category.update({ where: { id }, data })
        : name === 'tags'
          ? await tx.tag.update({ where: { id }, data })
          : name === 'allergens'
            ? await tx.allergen.update({ where: { id }, data })
            : await tx.city.update({ where: { id }, data });
    await audit(
      {
        actorId: actor.id,
        action: `${name}.update`,
        entityType: name,
        entityId: id,
        diff: data as unknown as Prisma.InputJsonObject,
        ip: actor.ip,
      },
      tx,
    );
    return updated;
  });
  return toDictionaryDto(row);
}

export async function deleteDictionaryItem(name: DictionaryName, id: bigint, actor: AdminActor) {
  await prisma.$transaction(async (tx) => {
    const where = { id };
    const result =
      name === 'categories'
        ? await tx.category.deleteMany({ where })
        : name === 'tags'
          ? await tx.tag.deleteMany({ where })
          : name === 'allergens'
            ? await tx.allergen.deleteMany({ where })
            : await tx.city.deleteMany({ where });
    if (result.count === 0) throw notFound('Запис не знайдено');
    await audit(
      { actorId: actor.id, action: `${name}.delete`, entityType: name, entityId: id, ip: actor.ip },
      tx,
    );
  });
}

export async function updateSettings(input: Partial<BusinessSettings>, actor: AdminActor) {
  const before = await getSettings();
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(input)) {
      await tx.setting.upsert({
        where: { key },
        create: { key, value, updatedBy: actor.id },
        update: { value, updatedBy: actor.id },
      });
    }
    await audit(
      {
        actorId: actor.id,
        action: 'settings.update',
        entityType: 'settings',
        diff: {
          before: Object.fromEntries(
            Object.keys(input).map((k) => [k, before[k as keyof BusinessSettings]]),
          ),
          after: input,
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  resetSettingsCache();
  return getSettings();
}

export async function listAuditLog(
  filter: { entityType?: string; entityId?: number; actorId?: number; action?: string } & Page,
) {
  const where: Prisma.AuditLogWhereInput = {
    ...(filter.entityType && { entityType: filter.entityType }),
    ...(filter.entityId && { entityId: filter.entityId }),
    ...(filter.actorId && { actorId: filter.actorId }),
    ...(filter.action && { action: { startsWith: filter.action } }),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { email: true } } },
      orderBy: { id: 'desc' },
      skip: (filter.page - 1) * filter.limit,
      take: filter.limit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    data: items.map((a) => ({
      id: Number(a.id),
      actorId: a.actorId ? Number(a.actorId) : null,
      actorEmail: a.actor?.email ?? null,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ? Number(a.entityId) : null,
      diff: a.diff,
      createdAt: a.createdAt.toISOString(),
    })),
    meta: { page: filter.page, limit: filter.limit, total },
  };
}
