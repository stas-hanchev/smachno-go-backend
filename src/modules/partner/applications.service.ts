import type { PartnerApplication } from '../../generated/prisma/client.js';
import { decrypt, encrypt, maskTail } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { emit, rooms } from '../../lib/realtime.js';

export interface ApplicationInput {
  businessName: string;
  venueType: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  legalName: string;
  taxId: string;
  iban: string;
  venuesCount?: number;
}

export function toApplicationDto(app: PartnerApplication, options: { reveal?: boolean } = {}) {
  const secret = (value: string) => {
    const plain = decrypt(value);
    return options.reveal ? plain : maskTail(plain);
  };
  return {
    id: Number(app.id),
    userId: Number(app.userId),
    businessName: app.businessName,
    venueType: app.venueType,
    contactName: app.contactName,
    contactPhone: app.contactPhone,
    contactEmail: app.contactEmail,
    address: app.address,
    legalName: app.legalName,
    taxId: secret(app.taxId),
    iban: secret(app.iban),
    venuesCount: app.venuesCount,
    status: app.status,
    rejectReason: app.rejectReason,
    createdAt: app.createdAt.toISOString(),
    reviewedAt: app.reviewedAt?.toISOString() ?? null,
  };
}

export async function submitApplication(userId: bigint, input: ApplicationInput) {
  const pending = await prisma.partnerApplication.count({
    where: { userId, status: 'submitted' },
  });
  if (pending) {
    throw new AppError('ORDER_STATE_CONFLICT', 'Ваша заявка вже на розгляді');
  }
  const app = await prisma.partnerApplication.create({
    data: {
      userId,
      businessName: input.businessName,
      venueType: input.venueType,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      address: input.address,
      legalName: input.legalName,
      taxId: encrypt(input.taxId),
      iban: encrypt(input.iban.replace(/\s+/g, '').toUpperCase()),
      venuesCount: input.venuesCount ?? 1,
    },
  });
  emit(rooms.admin, 'application:new', {
    id: Number(app.id),
    businessName: app.businessName,
    createdAt: app.createdAt.toISOString(),
  });
  return toApplicationDto(app);
}

export async function listMyApplications(userId: bigint) {
  const apps = await prisma.partnerApplication.findMany({
    where: { userId },
    orderBy: { id: 'desc' },
  });
  return apps.map((a) => toApplicationDto(a));
}
