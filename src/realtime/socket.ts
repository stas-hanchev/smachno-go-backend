import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { socketConnections } from '../lib/metrics.js';
import { prisma } from '../lib/prisma.js';
import { rooms, setRealtimeEmitter } from '../lib/realtime.js';
import { createRedis, redisEnabled } from '../lib/redis.js';
import { authenticateToken } from '../middleware/auth.js';

interface SocketData {
  user: Express.AuthUser | null;
}

type Ack = (response: { ok: boolean; error?: string }) => void;

const MAX_LISTING_ROOMS = 100;
const isAdmin = (user: Express.AuthUser | null) =>
  user?.role === 'admin' || user?.role === 'super_admin';

function ids(payload: unknown, key: string): bigint[] | null {
  const raw = (payload as Record<string, unknown> | null)?.[key];
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length || list.length > MAX_LISTING_ROOMS) return null;
  const result: bigint[] = [];
  for (const value of list) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (!/^\d{1,19}$/.test(String(value))) return null;
    result.push(BigInt(value));
  }
  return result;
}

function reply(ack: unknown, response: { ok: boolean; error?: string }) {
  if (typeof ack === 'function') (ack as Ack)(response);
}

async function canWatchVenue(user: Express.AuthUser | null, venueId: bigint): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const member = await prisma.venueMember.findUnique({
    where: { venueId_userId: { venueId, userId: user.id } },
    select: { status: true },
  });
  return member?.status === 'active';
}

function registerHandlers(socket: Socket) {
  const { user } = socket.data as SocketData;
  if (user) {
    void socket.join(rooms.user(user.id));
    if (isAdmin(user)) void socket.join(rooms.admin);
  }

  socket.on('listing:subscribe', (payload: unknown, ack: unknown) => {
    const listingIds = ids(payload, 'listingIds');
    if (!listingIds) return reply(ack, { ok: false, error: 'VALIDATION_ERROR' });
    void socket.join(listingIds.map((id) => rooms.listing(id)));
    reply(ack, { ok: true });
  });

  socket.on('listing:unsubscribe', (payload: unknown, ack: unknown) => {
    const listingIds = ids(payload, 'listingIds');
    if (!listingIds) return reply(ack, { ok: false, error: 'VALIDATION_ERROR' });
    for (const id of listingIds) void socket.leave(rooms.listing(id));
    reply(ack, { ok: true });
  });

  socket.on('venue:subscribe', async (payload: unknown, ack: unknown) => {
    const venueIds = ids(payload, 'venueId');
    const venueId = venueIds?.length === 1 ? venueIds[0]! : null;
    if (venueId === null) return reply(ack, { ok: false, error: 'VALIDATION_ERROR' });
    try {
      if (!(await canWatchVenue(user, venueId))) {
        return reply(ack, { ok: false, error: 'NOT_FOUND' });
      }
      await socket.join(rooms.venue(venueId));
      reply(ack, { ok: true });
    } catch (err) {
      logger.error({ err }, 'venue:subscribe failed');
      reply(ack, { ok: false, error: 'INTERNAL' });
    }
  });

  socket.on('venue:unsubscribe', (payload: unknown, ack: unknown) => {
    const venueIds = ids(payload, 'venueId');
    if (venueIds?.length !== 1) return reply(ack, { ok: false, error: 'VALIDATION_ERROR' });
    void socket.leave(rooms.venue(venueIds[0]!));
    reply(ack, { ok: true });
  });
}

export function attachRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    serveClient: false,
  });

  if (redisEnabled) {
    io.adapter(createAdapter(createRedis('socket-pub'), createRedis('socket-sub')));
  }

  io.use(async (socket, next) => {
    const data = socket.data as SocketData;
    const token: unknown = socket.handshake.auth?.token;
    data.user = null;
    if (typeof token !== 'string' || !token) return next();
    try {
      data.user = await authenticateToken(token);
      next();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNAUTHORIZED';
      next(Object.assign(new Error(code), { data: { code } }));
    }
  });

  io.on('connection', (socket) => {
    socketConnections.inc();
    socket.on('disconnect', () => socketConnections.dec());
    registerHandlers(socket);
  });

  setRealtimeEmitter((room, event, payload) => {
    io.to(room).emit(event, payload);
  });
  return io;
}
