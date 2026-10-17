import { Prisma } from '../generated/prisma/client.js';

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type DecimalValue = Prisma.Decimal | number | string;

export const toMoney = (value: DecimalValue): Prisma.Decimal =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const formatMoney = (value: DecimalValue): string => toMoney(value).toFixed(2);

export function discountPercent(price: DecimalValue, originalPrice: DecimalValue): number {
  const original = new Prisma.Decimal(originalPrice);
  if (original.lte(0)) return 0;
  return original
    .minus(price)
    .div(original)
    .times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR)
    .toNumber();
}
