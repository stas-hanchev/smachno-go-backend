import type { Prisma } from '../generated/prisma/client.js';
import { ipToBytes } from './ip.js';
import { prisma, type Tx } from './prisma.js';

export interface AuditEntry {
  actorId: bigint | null;
  action: string;
  entityType: string;
  entityId?: bigint | null;
  diff?: Prisma.InputJsonValue;
  ip?: string | undefined;
}

export async function audit(entry: AuditEntry, tx: Tx = prisma): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.diff !== undefined && { diff: entry.diff }),
      ip: ipToBytes(entry.ip),
    },
  });
}

export function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}
