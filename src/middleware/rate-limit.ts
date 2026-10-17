import type { Request, RequestHandler } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export function rateLimit(options: {
  points: number;
  durationSec: number;
  key?: (req: Request) => string;
}): RequestHandler {
  const limiter = new RateLimiterMemory({ points: options.points, duration: options.durationSec });
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
