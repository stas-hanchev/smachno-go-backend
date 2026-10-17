import { describe, expect, it } from 'vitest';
import { discountPercent, formatMoney, toMoney } from '../../src/lib/money.js';

describe('money', () => {
  it('formats amounts as strings with two decimals', () => {
    expect(formatMoney(89)).toBe('89.00');
    expect(formatMoney('12.345')).toBe('12.35');
    expect(toMoney('0.1').plus('0.2').toFixed(2)).toBe('0.30');
  });

  it('computes the discount badge, rounding down', () => {
    expect(discountPercent(89, 250)).toBe(64);
    expect(discountPercent(100, 100)).toBe(0);
    expect(discountPercent(1, 0)).toBe(0);
  });
});
