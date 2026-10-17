import jwt from 'jsonwebtoken';
import { ulid } from 'ulid';
import { env } from '../../config/env.js';
import type { UserRole } from '../../generated/prisma/enums.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

interface AccessPayload {
  sub: string;
  role: UserRole;
}

export function signAccessToken(userId: bigint, role: UserRole): string {
  return jwt.sign({ role } satisfies Omit<AccessPayload, 'sub'>, env.JWT_ACCESS_SECRET, {
    subject: userId.toString(),
    expiresIn: env.JWT_ACCESS_TTL_SEC,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): { userId: bigint; role: UserRole } {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as AccessPayload;
    return { userId: BigInt(payload.sub), role: payload.role };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError('TOKEN_EXPIRED');
    throw new AppError('UNAUTHORIZED');
  }
}

export interface SessionMeta {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

function ipToBytes(ip: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return new Uint8Array(v4.split('.').map(Number));
  return null;
}

export async function issueRefreshToken(
  userId: bigint,
  meta: SessionMeta,
  familyId: string = ulid(),
): Promise<string> {
  const token = randomToken(48);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      familyId,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ip: ipToBytes(meta.ip),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return token;
}

export async function rotateRefreshToken(
  token: string,
  meta: SessionMeta,
): Promise<{ userId: bigint; refreshToken: string }> {
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!existing) throw new AppError('UNAUTHORIZED');

  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError('UNAUTHORIZED');
  }
  if (existing.expiresAt <= new Date()) throw new AppError('TOKEN_EXPIRED');

  const revoked = await prisma.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count === 0) throw new AppError('UNAUTHORIZED');

  const refreshToken = await issueRefreshToken(existing.userId, meta, existing.familyId);
  return { userId: existing.userId, refreshToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshTokens(userId: bigint): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
