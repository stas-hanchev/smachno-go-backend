import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../config/env.js';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

function sslOptions() {
  if (env.DATABASE_SSL_CA) return { ca: env.DATABASE_SSL_CA, rejectUnauthorized: true };
  return env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined;
}

function createAdapter(databaseUrl: string): PrismaMariaDb {
  const ssl = sslOptions();
  const url = new URL(databaseUrl);
  return new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: env.DB_CONNECTION_LIMIT,
    allowPublicKeyRetrieval: true,
    timezone: 'Z',
    connectTimeout: 5_000,
    acquireTimeout: 10_000,
    ...(ssl && { ssl }),
  });
}

export const prisma = new PrismaClient({
  adapter: createAdapter(env.DATABASE_URL),
  transactionOptions: { maxWait: 10_000, timeout: 15_000 },
});

export type Db = typeof prisma;
export type Tx = Prisma.TransactionClient;
