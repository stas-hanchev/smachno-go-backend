import type { UserRole, VenueMemberRole } from '../generated/prisma/enums.js';

declare global {
  namespace Express {
    interface AuthUser {
      id: bigint;
      email: string;
      role: UserRole;
      emailVerified: boolean;
    }

    interface Request {
      user?: AuthUser;
      venueMember?: { venueId: bigint; role: VenueMemberRole };
    }
  }
}

export {};
