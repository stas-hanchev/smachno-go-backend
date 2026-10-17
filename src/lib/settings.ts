import { prisma } from './prisma.js';

export interface BusinessSettings {
  min_price_ratio: number;
  reservation_ttl_min: number;
  cancel_deadline_hours: number;
  grace_period_min: number;
  sales_close_offset_min: number;
  co2_per_kg: number;
  default_commission_rate: number;
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  min_price_ratio: 0.1,
  reservation_ttl_min: 10,
  cancel_deadline_hours: 2,
  grace_period_min: 15,
  sales_close_offset_min: 15,
  co2_per_kg: 2.5,
  default_commission_rate: 0.15,
};

const CACHE_TTL_MS = 60_000;
let cache: { value: BusinessSettings; expiresAt: number } | null = null;

export async function getSettings(): Promise<BusinessSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const rows = await prisma.setting.findMany();
  const value: BusinessSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in value && typeof row.value === 'number') {
      value[row.key as keyof BusinessSettings] = row.value;
    }
  }
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function resetSettingsCache(): void {
  cache = null;
}
