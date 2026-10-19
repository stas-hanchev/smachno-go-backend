import type { RequestHandler } from 'express';
import type { UserRole, VenueMemberRole } from '../generated/prisma/enums.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

export async function authenticateToken(token: string): Promise<Express.AuthUser> {
  const { userId } = verifyAccessToken(token);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, status: true, emailVerifiedAt: true },
  });
  if (!user || user.status === 'deleted') throw new AppError('UNAUTHORIZED');
  if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED');
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req.headers.authorization);
  if (!token) throw new AppError('UNAUTHORIZED');
  req.user = await authenticateToken(token);
  next();
};

export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req.headers.authorization);
  if (token) {
    try {
      req.user = await authenticateToken(token);
    } catch {}
  }
  next();
};

export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new AppError('UNAUTHORIZED');
  if (!req.user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED');
  next();
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new AppError('UNAUTHORIZED');
    if (!roles.includes(req.user.role)) throw new AppError('FORBIDDEN');
    next();
  };
}

export function requireVenueRole(
  roles: VenueMemberRole[],
  options: { allowAdmin?: boolean } = {},
): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) throw new AppError('UNAUTHORIZED');
    const raw = req.params.venueId;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new AppError('NOT_FOUND');
    const venueId = BigInt(raw);

    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (isAdmin && options.allowAdmin) {
      const exists = await prisma.venue.count({ where: { id: venueId, deletedAt: null } });
      if (!exists) throw new AppError('NOT_FOUND');
      req.venueMember = { venueId, role: 'owner' };
      return next();
    }

    const member = await prisma.venueMember.findUnique({
      where: { venueId_userId: { venueId, userId: req.user.id } },
      select: { role: true, status: true },
    });
    if (!member || member.status !== 'active') throw new AppError('NOT_FOUND');
    if (!roles.includes(member.role)) throw new AppError('FORBIDDEN');
    req.venueMember = { venueId, role: member.role };
    next();
  };
}
