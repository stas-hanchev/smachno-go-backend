import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday, kyivDate, kyivTime, kyivToUtc } from '../../src/lib/time.js';

describe('Kyiv time helpers', () => {
  it('converts summer time (UTC+3)', () => {
    expect(kyivToUtc('2026-10-16', '19:00').toISOString()).toBe('2026-10-16T16:00:00.000Z');
  });

  it('converts winter time (UTC+2)', () => {
    expect(kyivToUtc('2026-12-01', '19:00').toISOString()).toBe('2026-12-01T17:00:00.000Z');
  });

  it('handles the day of the DST switch (last Sunday of October)', () => {
    expect(kyivToUtc('2026-10-25', '12:00').toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });

  it('returns the Kyiv calendar date and time for a UTC instant', () => {
    const instant = new Date('2026-10-16T22:30:00Z');
    expect(kyivDate(instant)).toBe('2026-10-17');
    expect(kyivTime(instant)).toBe('01:30');
  });

  it('computes ISO weekdays and adds days across months', () => {
    expect(isoWeekday('2026-10-16')).toBe(5);
    expect(isoWeekday('2026-10-18')).toBe(7);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});
