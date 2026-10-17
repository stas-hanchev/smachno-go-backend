import { env } from '../../config/env.js';
import { hmacSha256, safeEqual, sha256 } from '../../lib/crypto.js';

export function buildVoucherToken(publicId: string, venueId: bigint, validUntil: Date): string {
  const exp = Math.floor(validUntil.getTime() / 1000);
  const payload = Buffer.from(`${publicId}.${venueId}.${exp}`).toString('base64url');
  return `${payload}.${hmacSha256(payload, env.VOUCHER_HMAC_SECRET)}`;
}

export interface VoucherClaims {
  publicId: string;
  venueId: bigint;
  exp: Date;
}

export function parseVoucherToken(token: string): VoucherClaims | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, hmacSha256(payload, env.VOUCHER_HMAC_SECRET))) return null;
  const [publicId, venueId, exp] = Buffer.from(payload, 'base64url').toString('utf8').split('.');
  if (!publicId || !venueId || !exp || !/^\d+$/.test(venueId) || !/^\d+$/.test(exp)) return null;
  return { publicId, venueId: BigInt(venueId), exp: new Date(Number(exp) * 1000) };
}

export const voucherTokenHash = (token: string) => sha256(token);
