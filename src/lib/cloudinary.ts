import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { ulid } from 'ulid';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

export const cloudinaryEnabled = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const MAX_SIDE_PX = 2000;
const DELIVERY = 'f_auto,q_auto';

export function deliveryUrl(cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${cloudName}/image/upload/${DELIVERY}/${publicId}`;
}

export function publicIdFromUrl(url: string, cloudName = env.CLOUDINARY_CLOUD_NAME): string | null {
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  if (!cloudName || !url.startsWith(prefix)) return null;
  const segments = url.slice(prefix.length).split('?')[0]!.split('/');
  while (segments.length > 1 && (segments[0]!.includes(',') || /^[a-z]{1,2}_/.test(segments[0]!))) {
    segments.shift();
  }
  if (segments.length > 1 && /^v\d+$/.test(segments[0]!)) segments.shift();
  const publicId = segments.join('/').replace(/\.[a-z0-9]+$/i, '');
  return publicId || null;
}

export async function uploadImage(
  buffer: Buffer,
  options: { folder: string; prefix: string },
): Promise<string> {
  if (!cloudinaryEnabled) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Завантаження фото ще не налаштовано');
  }
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${env.CLOUDINARY_FOLDER}/${options.folder}`,
        public_id: `${options.prefix}-${ulid().toLowerCase()}`,
        resource_type: 'image',
        overwrite: false,
        allowed_formats: ['jpg', 'png', 'webp'],
        transformation: [{ width: MAX_SIDE_PX, height: MAX_SIDE_PX, crop: 'limit' }],
      },
      (error, response) => {
        if (error || !response) reject(error ?? new Error('Empty Cloudinary response'));
        else resolve(response);
      },
    );
    stream.end(buffer);
  }).catch((err: unknown) => {
    logger.error({ err }, 'Cloudinary upload failed');
    throw new AppError('SERVICE_UNAVAILABLE', 'Не вдалося завантажити фото, спробуйте ще раз');
  });
  return deliveryUrl(env.CLOUDINARY_CLOUD_NAME, result.public_id);
}

export async function deleteImage(url: string | null | undefined): Promise<void> {
  if (!url || !cloudinaryEnabled) return;
  const publicId = publicIdFromUrl(url);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
  } catch (err) {
    logger.warn({ err, publicId }, 'Cloudinary delete failed');
  }
}
