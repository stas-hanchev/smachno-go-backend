import Joi from 'joi';

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: string;
  CORS_ORIGINS: string[];
  APP_URL: string;
  API_PUBLIC_URL: string;
  DATABASE_URL: string;
  DB_CONNECTION_LIMIT: number;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL_SEC: number;
  REFRESH_TOKEN_TTL_DAYS: number;
  VOUCHER_HMAC_SECRET: string;
  DATA_ENCRYPTION_KEY: string;
  BCRYPT_COST: number;
  COOKIE_SAMESITE: 'lax' | 'strict' | 'none';
  COOKIE_SECURE: boolean;
  GOOGLE_CLIENT_ID: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  MAIL_FROM: string;
  PAYMENT_PROVIDER: 'fake' | 'liqpay';
  LIQPAY_PUBLIC_KEY: string;
  LIQPAY_PRIVATE_KEY: string;
  LIQPAY_SANDBOX: boolean;
  RUN_JOBS_IN_PROCESS: boolean;
}

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4000),
  LOG_LEVEL: Joi.string().default('info'),
  CORS_ORIGINS: Joi.string()
    .default('http://localhost:3000')
    .custom((value: string) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  API_PUBLIC_URL: Joi.string().uri().default('http://localhost:4000'),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['mysql'] })
    .required(),
  DB_CONNECTION_LIMIT: Joi.number().integer().min(1).default(10),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SEC: Joi.number().integer().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(30),
  VOUCHER_HMAC_SECRET: Joi.string().min(32).required(),
  DATA_ENCRYPTION_KEY: Joi.string()
    .base64()
    .required()
    .custom((value: string, helpers) =>
      Buffer.from(value, 'base64').length === 32 ? value : helpers.error('any.invalid'),
    )
    .messages({ 'any.invalid': 'DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64' }),
  BCRYPT_COST: Joi.number().integer().min(4).max(15).default(12),
  COOKIE_SAMESITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
  COOKIE_SECURE: Joi.boolean().default(false),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('SmachnoGo <no-reply@smachnogo.local>'),
  PAYMENT_PROVIDER: Joi.string().valid('fake', 'liqpay').default('fake'),
  LIQPAY_PUBLIC_KEY: Joi.string().allow('').default(''),
  LIQPAY_PRIVATE_KEY: Joi.string().allow('').default(''),
  LIQPAY_SANDBOX: Joi.boolean().default(false),
  RUN_JOBS_IN_PROCESS: Joi.boolean().default(true),
}).unknown(true);

function loadEnv(): Env {
  const { error, value } = schema.validate(process.env, { abortEarly: false, convert: true });
  if (error) {
    const details = error.details.map((d) => `  - ${d.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const env = value as Env;
  if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'fake') {
    throw new Error('PAYMENT_PROVIDER=fake is not allowed in production');
  }
  if (env.PAYMENT_PROVIDER === 'liqpay' && (!env.LIQPAY_PUBLIC_KEY || !env.LIQPAY_PRIVATE_KEY)) {
    throw new Error('PAYMENT_PROVIDER=liqpay requires LIQPAY_PUBLIC_KEY and LIQPAY_PRIVATE_KEY');
  }
  if (env.NODE_ENV === 'production' && env.LIQPAY_SANDBOX) {
    throw new Error('LIQPAY_SANDBOX=true is not allowed in production');
  }
  if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
    throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  }
  return env;
}

export const env = loadEnv();
