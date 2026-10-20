import { deleteImage, uploadImage } from '../../lib/cloudinary.js';
import { AppError, businessRule, notFound } from '../../lib/errors.js';
import { detectImageType } from '../../lib/images.js';
import { uploads } from '../../lib/metrics.js';
import { prisma } from '../../lib/prisma.js';

export const MAX_VENUE_PHOTOS = 10;

export type VenueImageKind = 'logo' | 'cover';

function assertImage(file: Express.Multer.File | undefined): Buffer {
  if (!file) {
    throw new AppError('VALIDATION_ERROR', 'Додайте файл зображення', [
      { field: 'file', message: 'Файл обовʼязковий' },
    ]);
  }
  if (!detectImageType(file.buffer)) {
    throw new AppError('VALIDATION_ERROR', 'Підтримуються лише JPEG, PNG і WebP', [
      { field: 'file', message: 'Непідтримуваний формат зображення' },
    ]);
  }
  return file.buffer;
}

async function upload(kind: string, buffer: Buffer, folder: string) {
  try {
    const url = await uploadImage(buffer, { folder, prefix: kind });
    uploads.inc({ kind, result: 'ok' });
    return url;
  } catch (err) {
    uploads.inc({ kind, result: 'error' });
    throw err;
  }
}

export async function setVenueImage(
  venueId: bigint,
  kind: VenueImageKind,
  file: Express.Multer.File | undefined,
) {
  const buffer = assertImage(file);
  const venue = await prisma.venue.findFirst({
    where: { id: venueId, deletedAt: null },
    select: { logoUrl: true, coverUrl: true },
  });
  if (!venue) throw notFound('Заклад не знайдено');
  const url = await upload(kind, buffer, `venues/${venueId}`);
  await prisma.venue.update({
    where: { id: venueId },
    data: kind === 'logo' ? { logoUrl: url } : { coverUrl: url },
  });
  await deleteImage(kind === 'logo' ? venue.logoUrl : venue.coverUrl);
  return { url };
}

export async function removeVenueImage(venueId: bigint, kind: VenueImageKind) {
  const venue = await prisma.venue.findFirst({
    where: { id: venueId, deletedAt: null },
    select: { logoUrl: true, coverUrl: true },
  });
  if (!venue) throw notFound('Заклад не знайдено');
  await prisma.venue.update({
    where: { id: venueId },
    data: kind === 'logo' ? { logoUrl: null } : { coverUrl: null },
  });
  await deleteImage(kind === 'logo' ? venue.logoUrl : venue.coverUrl);
}

async function listVenuePhotos(venueId: bigint) {
  const photos = await prisma.venuePhoto.findMany({
    where: { venueId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return photos.map((p) => ({ id: Number(p.id), url: p.url, sortOrder: p.sortOrder }));
}

export async function addVenuePhoto(venueId: bigint, file: Express.Multer.File | undefined) {
  const buffer = assertImage(file);
  const count = await prisma.venuePhoto.count({ where: { venueId } });
  if (count >= MAX_VENUE_PHOTOS) {
    throw businessRule(`Можна додати не більше ${MAX_VENUE_PHOTOS} фото закладу`);
  }
  const url = await upload('photo', buffer, `venues/${venueId}`);
  const last = await prisma.venuePhoto.findFirst({
    where: { venueId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  await prisma.venuePhoto.create({
    data: { venueId, url, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return listVenuePhotos(venueId);
}

export async function deleteVenuePhoto(venueId: bigint, photoId: bigint) {
  const photo = await prisma.venuePhoto.findFirst({ where: { id: photoId, venueId } });
  if (!photo) throw notFound('Фото не знайдено');
  await prisma.venuePhoto.delete({ where: { id: photo.id } });
  await deleteImage(photo.url);
  return listVenuePhotos(venueId);
}

async function loadOffer(venueId: bigint, offerId: bigint) {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, venueId },
    select: { id: true, photoUrl: true },
  });
  if (!offer) throw notFound('Набір не знайдено');
  return offer;
}

export async function setOfferPhoto(
  venueId: bigint,
  offerId: bigint,
  file: Express.Multer.File | undefined,
) {
  const buffer = assertImage(file);
  const offer = await loadOffer(venueId, offerId);
  const url = await upload('offer', buffer, `venues/${venueId}/offers`);
  await prisma.offer.update({ where: { id: offer.id }, data: { photoUrl: url } });
  await deleteImage(offer.photoUrl);
  return { url };
}

export async function removeOfferPhoto(venueId: bigint, offerId: bigint) {
  const offer = await loadOffer(venueId, offerId);
  await prisma.offer.update({ where: { id: offer.id }, data: { photoUrl: null } });
  await deleteImage(offer.photoUrl);
}
