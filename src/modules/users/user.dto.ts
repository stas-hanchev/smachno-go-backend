import type { User } from '../../generated/prisma/client.js';

export interface UserDto {
  id: number;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: User['role'];
  homeLat: number | null;
  homeLng: number | null;
  homeAddress: string | null;
  searchRadiusKm: number;
  cityId: number | null;
}

export function toUserDto(user: User): UserDto {
  return {
    id: Number(user.id),
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    role: user.role,
    homeLat: user.homeLat ? user.homeLat.toNumber() : null,
    homeLng: user.homeLng ? user.homeLng.toNumber() : null,
    homeAddress: user.homeAddress,
    searchRadiusKm: user.searchRadiusKm,
    cityId: user.cityId ? Number(user.cityId) : null,
  };
}
