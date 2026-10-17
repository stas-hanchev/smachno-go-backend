import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../config/env.js';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

function createAdapter(databaseUrl: string): PrismaMariaDb {
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
  });
}

export const prisma = new PrismaClient({
  adapter: createAdapter(env.DATABASE_URL),
  transactionOptions: { maxWait: 10_000, timeout: 15_000 },
});

export type Db = typeof prisma;
export type Tx = Prisma.TransactionClient;
