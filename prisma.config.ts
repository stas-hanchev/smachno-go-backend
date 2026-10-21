import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile();
} catch {}

function databaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? '';
  const ca = (process.env.DATABASE_SSL_CA ?? '').replace(/\\n/g, '\n');
  if (!raw || (!ca && process.env.DATABASE_SSL !== 'true')) return raw;
  const url = new URL(raw);
  url.searchParams.set('sslaccept', 'strict');
  if (ca) {
    const caPath = join(tmpdir(), 'smachnogo-db-ca.pem');
    writeFileSync(caPath, ca);
    url.searchParams.set('sslcert', caPath);
  }
  return url.toString();
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl(),
  },
});
