import type { Notification, NotificationSettings, Prisma } from '../../generated/prisma/client.js';
import type { AfterCommit } from '../../lib/after-commit.js';
import { sendMail } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { emit, rooms } from '../../lib/realtime.js';

export type NotificationCategory = 'order_updates' | 'pickup_reminders' | 'account';

export interface NotificationInput {
  userId: bigint;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null>;
  email?: { subject: string; text: string };
}

function emailAllowed(category: NotificationCategory, settings: NotificationSettings | null) {
  if (category === 'account' || !settings) return true;
  if (!settings.emailEnabled) return false;
  return category === 'order_updates' ? settings.orderUpdates : settings.pickupReminders;
}

export function toNotificationDto(n: Notification) {
  return {
    id: Number(n.id),
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function notify(input: NotificationInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { notificationSettings: true },
  });
  if (!user || user.status === 'deleted') return;

  const notification = await prisma.notification.create({
    data: {
      userId: user.id,
      type: input.type,
      title: input.title.slice(0, 255),
      body: input.body.slice(0, 1000),
      ...(input.data && { data: input.data as Prisma.InputJsonObject }),
    },
  });
  emit(rooms.user(user.id), 'notification:new', toNotificationDto(notification));

  if (input.email && emailAllowed(input.category, user.notificationSettings)) {
    await sendMail({ to: user.email, ...input.email });
  }
}

export function notifyAfterCommit(after: AfterCommit, input: NotificationInput): void {
  after.add(() => notify(input));
}

export async function listNotifications(userId: bigint, unreadOnly: boolean, limit: number) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { id: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { data: items.map(toNotificationDto), unread };
}

export async function markRead(userId: bigint, ids?: number[]) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids.map(BigInt) } } : {}) },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

const SETTINGS_FIELDS = [
  'emailEnabled',
  'pushEnabled',
  'orderUpdates',
  'pickupReminders',
  'favoritesNewListings',
  'marketing',
] as const;

type SettingsField = (typeof SETTINGS_FIELDS)[number];

function toSettingsDto(settings: NotificationSettings) {
  return Object.fromEntries(SETTINGS_FIELDS.map((f) => [f, settings[f]])) as Record<
    SettingsField,
    boolean
  >;
}

export async function getNotificationSettings(userId: bigint) {
  const settings = await prisma.notificationSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return toSettingsDto(settings);
}

export async function updateNotificationSettings(
  userId: bigint,
  input: Partial<Record<SettingsField, boolean>>,
) {
  const settings = await prisma.notificationSettings.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
  return toSettingsDto(settings);
}
