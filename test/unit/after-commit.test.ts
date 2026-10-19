import { describe, expect, it } from 'vitest';
import { publishAfterCommit } from '../../src/lib/after-commit.js';
import { emittedEvents } from '../../src/lib/realtime.js';
import { slugify } from '../../src/lib/slug.js';

describe('publishAfterCommit', () => {
  it('runs effects only after the work succeeds', async () => {
    emittedEvents.length = 0;
    const order: string[] = [];
    const result = await publishAfterCommit(async (after) => {
      after.add(() => order.push('effect'));
      after.emit('user:1', 'order:status', { status: 'paid' });
      order.push('work');
      return 42;
    });
    expect(result).toBe(42);
    expect(order).toEqual(['work', 'effect']);
    expect(emittedEvents).toEqual([
      { room: 'user:1', event: 'order:status', payload: { status: 'paid' } },
    ]);
  });

  it('drops effects when the work fails', async () => {
    emittedEvents.length = 0;
    await expect(
      publishAfterCommit(async (after) => {
        after.emit('user:1', 'order:status', { status: 'paid' });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(emittedEvents).toEqual([]);
  });

  it('keeps running effects after one of them fails', async () => {
    const order: string[] = [];
    await publishAfterCommit(async (after) => {
      after.add(() => {
        throw new Error('mail server is down');
      });
      after.add(() => order.push('second'));
    });
    expect(order).toEqual(['second']);
  });
});

describe('slugify', () => {
  it('transliterates Ukrainian names', () => {
    expect(slugify('Хліб і Сіль')).toBe('khlib-i-sil');
    expect(slugify("Кав'ярня «Щастя» №5")).toBe('kaviarnia-shchastia-no5');
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('!!!')).toBe('item');
  });
});
