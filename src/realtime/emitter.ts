import { Emitter } from '@socket.io/redis-emitter';
import { setRealtimeEmitter } from '../lib/realtime.js';
import { createRedis } from '../lib/redis.js';

export function attachRedisEmitter(): void {
  const emitter = new Emitter(createRedis('socket-emitter'));
  setRealtimeEmitter((room, event, payload) => {
    emitter.to(room).emit(event, payload);
  });
}
