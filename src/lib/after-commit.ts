import { logger } from './logger.js';
import { emit, type RealtimeEvent } from './realtime.js';

type Effect = () => unknown;

export class AfterCommit {
  private readonly effects: Effect[] = [];

  add(effect: Effect): void {
    this.effects.push(effect);
  }

  emit(room: string, event: RealtimeEvent, payload: unknown): void {
    this.add(() => emit(room, event, payload));
  }

  async flush(): Promise<void> {
    for (const effect of this.effects.splice(0)) {
      try {
        await effect();
      } catch (err) {
        logger.error({ err }, 'After-commit effect failed');
      }
    }
  }
}

export async function publishAfterCommit<T>(work: (after: AfterCommit) => Promise<T>): Promise<T> {
  const after = new AfterCommit();
  const result = await work(after);
  await after.flush();
  return result;
}
