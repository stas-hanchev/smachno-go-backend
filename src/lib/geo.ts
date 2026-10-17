import { Prisma } from '../generated/prisma/client.js';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function boundingBox(center: LatLng, radiusM: number): BoundingBox {
  const latDelta = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lngDelta = latDelta / Math.max(Math.cos(toRad(center.lat)), 0.01);
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}

export function sqlDistance(alias: string, point: LatLng): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`(2 * ${EARTH_RADIUS_M} * ASIN(LEAST(1, SQRT(
    POWER(SIN(RADIANS(${a}.lat - ${point.lat}) / 2), 2) +
    COS(RADIANS(${point.lat})) * COS(RADIANS(${a}.lat)) *
    POWER(SIN(RADIANS(${a}.lng - ${point.lng}) / 2), 2)
  ))))`;
}

export function sqlInBox(alias: string, box: BoundingBox): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`${a}.lat BETWEEN ${box.minLat} AND ${box.maxLat} AND ${a}.lng BETWEEN ${box.minLng} AND ${box.maxLng}`;
}
