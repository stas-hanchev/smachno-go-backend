import { env } from '../../config/env.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, businessRule, forbidden, notFound } from '../../lib/errors.js';
import { sendMail } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';

const INVITE_TTL_MS = 7 * 24 * 3_600_000;
const MAX_PENDING_INVITES = 20;

interface InvitePayload {
  venueId: string;
  email: string;
}

function invitePayload(value: unknown): InvitePayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const { venueId, email } = value as Record<string, unknown>;
  return typeof venueId === 'string' && typeof email === 'string' ? { venueId, email } : null;
}

function pendingInvitesWhere(venueId: bigint) {
  return {
    type: 'staff_invite' as const,
    usedAt: null,
    expiresAt: { gt: new Date() },
    payload: { path: '$.venueId', equals: venueId.toString() },
  };
}

export async function listMembers(venueId: bigint) {
  const [members, invites] = await Promise.all([
    prisma.venueMember.findMany({
      where: { venueId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.authToken.findMany({ where: pendingInvitesWhere(venueId), orderBy: { id: 'asc' } }),
  ]);
  return {
    members: members.map((m) => ({
      userId: Number(m.userId),
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      role: m.role,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
    })),
    invites: invites.map((i) => ({
      id: Number(i.id),
      email: invitePayload(i.payload)?.email ?? null,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

export async function inviteMember(venueId: bigint, email: string, inviterId: bigint) {
  const venue = await prisma.venue.findFirst({
    where: { id: venueId, deletedAt: null },
    select: { name: true },
  });
  if (!venue) throw notFound('Заклад не знайдено');

  const existing = await prisma.venueMember.findFirst({
    where: { venueId, user: { email }, status: 'active' },
  });
  if (existing) throw new AppError('ORDER_STATE_CONFLICT', 'Ця людина вже є в команді закладу');

  const pending = await prisma.authToken.findMany({ where: pendingInvitesWhere(venueId) });
  if (pending.length >= MAX_PENDING_INVITES) {
    throw businessRule('Забагато активних запрошень. Скасуйте частину з них');
  }
  const sameEmail = pending.filter((t) => invitePayload(t.payload)?.email === email);

  const token = randomToken();
  const invite = await prisma.$transaction(async (tx) => {
    if (sameEmail.length) {
      await tx.authToken.updateMany({
        where: { id: { in: sameEmail.map((t) => t.id) } },
        data: { usedAt: new Date() },
      });
    }
    return tx.authToken.create({
      data: {
        userId: inviterId,
        type: 'staff_invite',
        tokenHash: sha256(token),
        payload: { venueId: venueId.toString(), email } satisfies InvitePayload,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  });

  const link = `${env.APP_URL}/partner/invite?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: `Запрошення до команди ${venue.name} у СмачноGo`,
    text: `Вітаємо!\n\nВас запросили до команди закладу «${venue.name}» у СмачноGo, щоб видавати замовлення та керувати випусками.\n\nЩоб прийняти запрошення, увійдіть або зареєструйтеся з цією адресою та перейдіть за посиланням (дійсне 7 днів):\n${link}\n\nЯкщо ви не очікували цього листа, просто проігноруйте його.`,
  });
  return {
    id: Number(invite.id),
    email,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  };
}

export async function revokeInvite(venueId: bigint, inviteId: bigint) {
  const result = await prisma.authToken.updateMany({
    where: { id: inviteId, ...pendingInvitesWhere(venueId) },
    data: { usedAt: new Date() },
  });
  if (result.count === 0) throw notFound('Запрошення не знайдено');
}

async function findStaffMember(venueId: bigint, userId: bigint, actorId: bigint) {
  if (userId === actorId) throw businessRule('Не можна змінити власний доступ');
  const member = await prisma.venueMember.findUnique({
    where: { venueId_userId: { venueId, userId } },
  });
  if (!member) throw notFound('Учасника команди не знайдено');
  if (member.role === 'owner') throw forbidden('Доступ власника може змінити лише адміністратор');
  return member;
}

export async function updateMember(
  venueId: bigint,
  userId: bigint,
  status: 'active' | 'disabled',
  actorId: bigint,
) {
  await findStaffMember(venueId, userId, actorId);
  await prisma.venueMember.update({
    where: { venueId_userId: { venueId, userId } },
    data: { status },
  });
  return listMembers(venueId);
}

export async function removeMember(venueId: bigint, userId: bigint, actorId: bigint) {
  await findStaffMember(venueId, userId, actorId);
  await prisma.venueMember.delete({ where: { venueId_userId: { venueId, userId } } });
}

export async function acceptInvite(token: string, user: Express.AuthUser) {
  const record = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  const payload = invitePayload(record?.payload);
  if (
    !record ||
    !payload ||
    record.type !== 'staff_invite' ||
    record.usedAt ||
    record.expiresAt <= new Date()
  ) {
    throw new AppError('INVALID_TOKEN');
  }
  if (payload.email !== user.email) {
    throw forbidden(`Запрошення надіслано на ${payload.email}. Увійдіть з цією адресою`);
  }
  const venueId = BigInt(payload.venueId);
  const venue = await prisma.venue.findFirst({
    where: { id: venueId, deletedAt: null },
    select: { id: true, name: true, slug: true, status: true },
  });
  if (!venue) throw new AppError('INVALID_TOKEN');

  const role = await prisma.$transaction(async (tx) => {
    const used = await tx.authToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count === 0) throw new AppError('INVALID_TOKEN');
    await tx.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    const member = await tx.venueMember.findUnique({
      where: { venueId_userId: { venueId, userId: user.id } },
    });
    if (member?.role === 'owner') return member.role;
    await tx.venueMember.upsert({
      where: { venueId_userId: { venueId, userId: user.id } },
      create: {
        venueId,
        userId: user.id,
        role: 'staff',
        status: 'active',
        invitedBy: record.userId,
      },
      update: { status: 'active', invitedBy: record.userId },
    });
    return 'staff' as const;
  });

  return { id: Number(venue.id), name: venue.name, slug: venue.slug, status: venue.status, role };
}
