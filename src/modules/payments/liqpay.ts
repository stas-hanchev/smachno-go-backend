import { createHash } from 'node:crypto';
import { safeEqual } from '../../lib/crypto.js';

export const LIQPAY_CHECKOUT_URL = 'https://www.liqpay.ua/api/3/checkout';
export const LIQPAY_API_URL = 'https://www.liqpay.ua/api/request';

export type LiqpayParams = Record<string, string | number>;
export type LiqpayPayload = Record<string, unknown>;

export function liqpaySignature(data: string, privateKey: string): string {
  return createHash('sha1')
    .update(privateKey + data + privateKey)
    .digest('base64');
}

export function encodeLiqpayData(params: LiqpayParams): string {
  return Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
}

export function decodeLiqpayData(data: string): LiqpayPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as LiqpayPayload)
      : null;
  } catch {
    return null;
  }
}

export function verifyLiqpaySignature(data: string, signature: string, privateKey: string) {
  return safeEqual(signature, liqpaySignature(data, privateKey));
}

export type ProviderPaymentState = 'success' | 'failure' | 'pending' | 'reversed';

const FAILURE_STATUSES = new Set(['failure', 'error']);

export function liqpayState(status: unknown, sandbox: boolean): ProviderPaymentState {
  if (status === 'success' || (sandbox && status === 'sandbox')) return 'success';
  if (status === 'reversed') return 'reversed';
  if (typeof status === 'string' && FAILURE_STATUSES.has(status)) return 'failure';
  return 'pending';
}

export function liqpayExpiredDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
