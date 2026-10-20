import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const redisEnabled = Boolean(env.REDIS_URL);

const clients: Redis[] = [];

export function createRedis(name: string): Redis {
  if (!redisEnabled) throw new Error('REDIS_URL is not configured');
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: `smachnogo-${name}`,
  });
  client.on('error', (err) => logger.warn({ err, client: name }, 'Redis connection error'));
  clients.push(client);
  return client;
}

let shared: Redis | null = null;

export function redis(): Redis {
  shared ??= createRedis('shared');
  return shared;
}

export async function pingRedis(): Promise<boolean> {
  if (!redisEnabled) return true;
  try {
    return (await redis().ping()) === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled(clients.map((client) => client.quit()));
  clients.length = 0;
  shared = null;
}
