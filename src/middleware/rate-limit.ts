import type { Request, RequestHandler } from 'express';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { redis, redisEnabled } from '../lib/redis.js';

let nextId = 0;

function createLimiter(points: number, duration: number): RateLimiterAbstract {
  const memory = new RateLimiterMemory({ points, duration });
  if (!redisEnabled || env.NODE_ENV === 'test') return memory;
  nextId += 1;
  return new RateLimiterRedis({
    storeClient: redis(),
    keyPrefix: `rl:${nextId}:${points}:${duration}`,
    points,
    duration,
    insuranceLimiter: memory,
  });
}

export function rateLimit(options: {
  points: number;
  durationSec: number;
  key?: (req: Request) => string;
}): RequestHandler {
  const limiter = createLimiter(options.points, options.durationSec);
  return async (req, res, next) => {
    if (env.NODE_ENV === 'test') return next();
    const key = options.key ? options.key(req) : (req.ip ?? 'unknown');
    try {
      await limiter.consume(key);
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        res.setHeader('Retry-After', Math.ceil(err.msBeforeNext / 1000));
        throw new AppError('RATE_LIMITED');
      }
      throw err;
    }
  };
}

export const globalRateLimit = rateLimit({ points: 300, durationSec: 60 });
