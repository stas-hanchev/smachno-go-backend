import { defineConfig } from 'vitest/config';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: 'node',
    include: testDatabaseUrl ? ['test/**/*.test.ts'] : ['test/unit/**/*.test.ts'],
    globalSetup: testDatabaseUrl ? ['test/integration/global-setup.ts'] : [],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl ?? 'mysql://test:test@127.0.0.1:3306/unused',
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0001',
      VOUCHER_HMAC_SECRET: 'test-voucher-secret-test-voucher-secret-001',
      DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      BCRYPT_COST: '4',
      PAYMENT_PROVIDER: 'fake',
      RUN_JOBS_IN_PROCESS: 'false',
      SMTP_HOST: '',
    },
  },
});
