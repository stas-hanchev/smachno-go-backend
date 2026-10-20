import { describe, expect, it } from 'vitest';
import {
  computePreferences,
  DEFAULT_WEIGHTS,
  diversify,
  parseWeights,
  preferenceScore,
  scoreListing,
  type ScoreInput,
} from '../../src/modules/recommendations/scoring.js';

const now = new Date('2026-10-20T12:00:00Z');

const base: ScoreInput = {
  distanceM: 1000,
  radiusM: 5000,
  categoryId: 1,
  tagIds: [],
  popularity: 0,
  ratingAvg: null,
  discountPercent: 50,
  salesCloseAt: new Date('2026-10-20T18:00:00Z'),
  isFavoriteVenue: false,
};

describe('scoreListing', () => {
  it('follows the TZ 8.12 formula for a guest', () => {
    const score = scoreListing(base, DEFAULT_WEIGHTS, null, now);
    const expected = 0.3 * 0.8 + 0.25 * 0 + 0.15 * 0 + 0.1 * 0.7 + 0.1 * 0.5 + 0.1 * 0.5 + 0;
    expect(score).toBeCloseTo(expected, 6);
  });

  it('prefers closer, more urgent, favorite and preferred listings', () => {
    const score = (
      input: Partial<ScoreInput>,
      prefs = null as Parameters<typeof scoreListing>[2],
    ) => scoreListing({ ...base, ...input }, DEFAULT_WEIGHTS, prefs, now);
    expect(score({ distanceM: 200 })).toBeGreaterThan(score({}));
    expect(score({ salesCloseAt: new Date('2026-10-20T13:00:00Z') })).toBeGreaterThan(score({}));
    expect(score({ isFavoriteVenue: true })).toBeGreaterThan(score({}));
    const prefs = { categoryWeights: { '1': 1 }, tagWeights: {} };
    expect(score({}, prefs)).toBeGreaterThan(score({ categoryId: 2 }, prefs));
  });

  it('uses popularity instead of preferences for guests', () => {
    const popular = scoreListing({ ...base, popularity: 1 }, DEFAULT_WEIGHTS, null, now);
    const plain = scoreListing(base, DEFAULT_WEIGHTS, null, now);
    expect(popular - plain).toBeCloseTo(DEFAULT_WEIGHTS.preference + DEFAULT_WEIGHTS.popularity, 6);
  });
});

describe('diversify', () => {
  it('keeps at most two listings per venue and respects the limit', () => {
    const ranked = [1, 1, 1, 2, 2, 3].map((venueId, i) => ({ venueId, id: i }));
    expect(diversify(ranked, 10).map((r) => r.id)).toEqual([0, 1, 3, 4, 5]);
    expect(diversify(ranked, 2)).toHaveLength(2);
  });
});

describe('computePreferences', () => {
  it('weights events by type and decays them over 30 days', () => {
    const prefs = computePreferences(
      [
        { type: 'purchase', createdAt: now, categoryId: 1, tagIds: [7] },
        { type: 'view', createdAt: now, categoryId: 2, tagIds: [] },
        {
          type: 'purchase',
          createdAt: new Date(now.getTime() - 60 * 86_400_000),
          categoryId: 3,
          tagIds: [],
        },
        { type: 'impression', createdAt: now, categoryId: 4, tagIds: [] },
      ],
      now,
    );
    expect(prefs.categoryWeights['1']).toBe(1);
    expect(prefs.categoryWeights['2']).toBeCloseTo(0.2, 4);
    expect(prefs.categoryWeights['3']).toBeCloseTo(Math.exp(-2), 3);
    expect(prefs.categoryWeights['4']).toBeUndefined();
    expect(prefs.tagWeights['7']).toBe(1);
    expect(preferenceScore(prefs, 1, [7])).toBe(1);
  });
});

describe('parseWeights', () => {
  it('falls back to defaults for missing or invalid values', () => {
    expect(parseWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(parseWeights({ proximity: 0.5, discount: 7, urgency: 'x' })).toEqual({
      ...DEFAULT_WEIGHTS,
      proximity: 0.5,
    });
  });
});
