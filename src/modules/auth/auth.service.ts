import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import type { AuthTokenType, User } from '../../generated/prisma/client.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { sendPasswordResetEmail, sendVerifyEmail } from './auth.mail.js';
import {
  issueRefreshToken,
  revokeAllRefreshTokens,
  signAccessToken,
  type SessionMeta,
} from './tokens.js';

const EMAIL_VERIFY_TTL_MS = 24 * 3_600_000;
const PASSWORD_RESET_TTL_MS = 3_600_000;

export interface Session {
  user: User;
  accessToken: string;
  refreshToken: string;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function createSession(user: User, meta: SessionMeta): Promise<Session> {
  const [refreshToken] = await Promise.all([
    issueRefreshToken(user.id, meta),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ]);
  return { user, accessToken: signAccessToken(user.id, user.role), refreshToken };
}

async function createOneTimeToken(
  userId: bigint,
  type: AuthTokenType,
  ttlMs: number,
): Promise<string> {
  const token = randomToken();
  await prisma.authToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.authToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}

async function consumeOneTimeToken(token: string, type: AuthTokenType): Promise<bigint> {
  const record = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt <= new Date()) {
    throw new AppError('INVALID_TOKEN');
  }
  const used = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count === 0) throw new AppError('INVALID_TOKEN');
  return record.userId;
}

function assertCanSignIn(user: User): void {
  if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED');
  if (user.status === 'deleted') throw new AppError('INVALID_CREDENTIALS');
}

export async function register(
  input: { firstName: string; lastName?: string; email: string; password: string },
  meta: SessionMeta,
): Promise<Session> {
  const email = normalizeEmail(input.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('EMAIL_TAKEN');

  const user = await prisma.user.create({
    data: {
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName?.trim() || null,
      passwordHash: await bcrypt.hash(input.password, env.BCRYPT_COST),
      notificationSettings: { create: {} },
      stats: { create: {} },
    },
  });

  const token = await createOneTimeToken(user.id, 'email_verify', EMAIL_VERIFY_TTL_MS);
  await sendVerifyEmail(user.email, user.firstName, token);
  return createSession(user, meta);
}

export async function login(email: string, password: string, meta: SessionMeta): Promise<Session> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  const hash = user?.passwordHash ?? '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7pS2b7r5cS1b1xQ6o1H1zM0o1x2Zl6.';
  const valid = await bcrypt.compare(password, hash);
  if (!user || !user.passwordHash || !valid) throw new AppError('INVALID_CREDENTIALS');
  assertCanSignIn(user);
  return createSession(user, meta);
}

let googleClient: OAuth2Client | null = null;

export async function loginWithGoogle(idToken: string, meta: SessionMeta): Promise<Session> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Вхід через Google ще не налаштовано');
  }
  googleClient ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new AppError('UNAUTHORIZED', 'Не вдалося підтвердити вхід через Google');
  }
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw new AppError('UNAUTHORIZED', 'Google не підтвердив email цього облікового запису');
  }

  const providerUserId = payload.sub;
  const linked = await prisma.oauthAccount.findUnique({
    where: { provider_providerUserId: { provider: 'google', providerUserId } },
    include: { user: true },
  });
  if (linked) {
    assertCanSignIn(linked.user);
    return createSession(linked.user, meta);
  }

  const email = normalizeEmail(payload.email);
  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      await tx.oauthAccount.create({
        data: { userId: existing.id, provider: 'google', providerUserId },
      });
      return tx.user.update({
        where: { id: existing.id },
        data: { emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
      });
    }
    return tx.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        firstName: payload.given_name ?? payload.name ?? email.split('@')[0] ?? 'Користувач',
        lastName: payload.family_name ?? null,
        avatarUrl: payload.picture ?? null,
        oauthAccounts: { create: { provider: 'google', providerUserId } },
        notificationSettings: { create: {} },
        stats: { create: {} },
      },
    });
  });
  assertCanSignIn(user);
  return createSession(user, meta);
}

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeOneTimeToken(token, 'email_verify');
  await prisma.user.updateMany({
    where: { id: userId, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  });
}

export async function resendVerifyEmail(userId: bigint): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const token = await createOneTimeToken(user.id, 'email_verify', EMAIL_VERIFY_TTL_MS);
  await sendVerifyEmail(user.email, user.firstName, token);
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user || user.status !== 'active') return;
  const token = await createOneTimeToken(user.id, 'password_reset', PASSWORD_RESET_TTL_MS);
  await sendPasswordResetEmail(user.email, user.firstName, token);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const userId = await consumeOneTimeToken(token, 'password_reset');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await bcrypt.hash(password, env.BCRYPT_COST),
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });
  await revokeAllRefreshTokens(userId);
}

export async function changePassword(
  userId: bigint,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError('INVALID_CREDENTIALS', 'Поточний пароль неправильний');
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, env.BCRYPT_COST) },
  });
}
