export const BUSINESS_TZ = 'Europe/Kyiv';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function kyivOffsetMs(date: Date): number {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function kyivDate(date: Date = new Date()): string {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function kyivTime(date: Date = new Date()): string {
  const p = zonedParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function isoWeekday(date: string): number {
  const day = dateOnlyToDb(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function kyivToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  let result = wallAsUtc - kyivOffsetMs(new Date(wallAsUtc));
  result = wallAsUtc - kyivOffsetMs(new Date(result));
  return new Date(result);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function dateOnlyToDb(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function dbToDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function timeToDb(time: string): Date {
  return new Date(`1970-01-01T${time.length === 5 ? `${time}:00` : time}.000Z`);
}

export function dbToTime(value: Date): string {
  return value.toISOString().slice(11, 16);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
