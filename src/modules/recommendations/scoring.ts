export interface RecommendationWeights {
  proximity: number;
  preference: number;
  popularity: number;
  rating: number;
  discount: number;
  urgency: number;
  favorite: number;
}

export const DEFAULT_WEIGHTS: RecommendationWeights = {
  proximity: 0.3,
  preference: 0.25,
  popularity: 0.15,
  rating: 0.1,
  discount: 0.1,
  urgency: 0.1,
  favorite: 0.05,
};

export const NEW_VENUE_RATING = 0.7;
export const URGENCY_HORIZON_HOURS = 12;
export const MAX_PER_VENUE = 2;

export interface Preferences {
  categoryWeights: Record<string, number>;
  tagWeights: Record<string, number>;
}

export interface ScoreInput {
  distanceM: number | null;
  radiusM: number;
  categoryId: number;
  tagIds: number[];
  popularity: number;
  ratingAvg: string | null;
  discountPercent: number;
  salesCloseAt: Date;
  isFavoriteVenue: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function preferenceScore(prefs: Preferences, categoryId: number, tagIds: number[]): number {
  const category = prefs.categoryWeights[String(categoryId)] ?? 0;
  if (!tagIds.length) return clamp01(category);
  const tags =
    tagIds.reduce((sum, id) => sum + (prefs.tagWeights[String(id)] ?? 0), 0) / tagIds.length;
  return clamp01(0.5 * category + 0.5 * tags);
}

export function scoreListing(
  input: ScoreInput,
  weights: RecommendationWeights,
  prefs: Preferences | null,
  now: Date,
): number {
  const proximity =
    input.distanceM === null ? 0.5 : clamp01(1 - input.distanceM / Math.max(input.radiusM, 1));
  const rating = input.ratingAvg === null ? NEW_VENUE_RATING : clamp01(Number(input.ratingAvg) / 5);
  const hoursLeft = (input.salesCloseAt.getTime() - now.getTime()) / 3_600_000;
  const urgency = clamp01(1 - hoursLeft / URGENCY_HORIZON_HOURS);
  const popularity = clamp01(input.popularity);

  const preferencePart = prefs
    ? weights.preference * preferenceScore(prefs, input.categoryId, input.tagIds)
    : weights.preference * popularity;

  return (
    weights.proximity * proximity +
    preferencePart +
    weights.popularity * popularity +
    weights.rating * rating +
    weights.discount * clamp01(input.discountPercent / 100) +
    weights.urgency * urgency +
    weights.favorite * (input.isFavoriteVenue ? 1 : 0)
  );
}

export function diversify<T extends { venueId: number }>(
  ranked: T[],
  limit: number,
  maxPerVenue = MAX_PER_VENUE,
): T[] {
  const perVenue = new Map<number, number>();
  const result: T[] = [];
  for (const item of ranked) {
    const count = perVenue.get(item.venueId) ?? 0;
    if (count >= maxPerVenue) continue;
    perVenue.set(item.venueId, count + 1);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

export const INTERACTION_WEIGHTS: Record<string, number> = {
  purchase: 5,
  pickup: 5,
  favorite: 3,
  reserve: 2,
  view: 1,
};

export const PREFERENCE_DECAY_DAYS = 30;

export interface PreferenceEvent {
  type: string;
  createdAt: Date;
  categoryId: number;
  tagIds: number[];
}

function normalize(weights: Map<string, number>): Record<string, number> {
  const max = Math.max(0, ...weights.values());
  if (max === 0) return {};
  return Object.fromEntries(
    [...weights.entries()].map(([key, value]) => [key, Number((value / max).toFixed(4))]),
  );
}

export function computePreferences(events: PreferenceEvent[], now: Date): Preferences {
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const event of events) {
    const base = INTERACTION_WEIGHTS[event.type] ?? 0;
    if (!base) continue;
    const ageDays = Math.max(0, (now.getTime() - event.createdAt.getTime()) / 86_400_000);
    const weight = base * Math.exp(-ageDays / PREFERENCE_DECAY_DAYS);
    const categoryKey = String(event.categoryId);
    categories.set(categoryKey, (categories.get(categoryKey) ?? 0) + weight);
    for (const tagId of event.tagIds) {
      const tagKey = String(tagId);
      tags.set(tagKey, (tags.get(tagKey) ?? 0) + weight);
    }
  }
  return { categoryWeights: normalize(categories), tagWeights: normalize(tags) };
}

export function parseWeights(value: unknown): RecommendationWeights {
  if (!value || typeof value !== 'object') return DEFAULT_WEIGHTS;
  const result = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof RecommendationWeights)[]) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) result[key] = raw;
  }
  return result;
}
