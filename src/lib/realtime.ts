import { env } from '../config/env.js';

export type RealtimeEvent =
  | 'listing:updated'
  | 'order:status'
  | 'order:new'
  | 'order:updated'
  | 'notification:new'
  | 'application:new';

export interface EmittedEvent {
  room: string;
  event: RealtimeEvent;
  payload: unknown;
}

type Emitter = (room: string, event: RealtimeEvent, payload: unknown) => void;

let emitter: Emitter | null = null;

export const emittedEvents: EmittedEvent[] = [];

export function setRealtimeEmitter(fn: Emitter | null): void {
  emitter = fn;
}

export function emit(room: string, event: RealtimeEvent, payload: unknown): void {
  if (env.NODE_ENV === 'test') emittedEvents.push({ room, event, payload });
  emitter?.(room, event, payload);
}

export const rooms = {
  user: (id: bigint | number) => `user:${id}`,
  venue: (id: bigint | number) => `venue:${id}`,
  listing: (id: bigint | number) => `listing:${id}`,
  admin: 'admin',
} as const;
