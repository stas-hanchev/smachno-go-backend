# SmachnoGo API

REST API for SmachnoGo: venues sell surplus food as discounted sets, customers reserve them,
pay online and pick them up with a QR code. Specification: TZ 1.1 (`tz/smachnogo-tz.md` in the project files).

Stack: Node.js 24, TypeScript (strict), Express 5, celebrate (Joi), Prisma 7 with the MariaDB driver adapter, MySQL 8.

## Quick start

```bash
cp .env.example .env              # adjust if needed
docker compose up -d              # MySQL 8, Redis 7, MailHog (http://localhost:8025)
npm install
npm run db:deploy                 # apply migrations
npm run db:seed                   # Kyiv, Kharkiv, dictionaries, demo venues
npm run dev                       # http://localhost:4000
```

Without Docker, install MySQL 8 locally, create the `smachnogo` and `smachnogo_test` databases
(see `docker/mysql/init.sql`) and set `DATABASE_URL`. Leave `SMTP_HOST` empty to print emails to the log.

npm 12 does not run dependency install scripts by default; the allowed ones (Prisma engines, esbuild)
are listed in `allowScripts` in `package.json`.

Seed accounts (development only):

| Email                      | Password         | Role                     |
| -------------------------- | ---------------- | ------------------------ |
| `admin@smachnogo.local`    | `Admin12345!`    | super admin              |
| `partner@smachnogo.local`  | `Partner12345!`  | owner of all demo venues |
| `customer@smachnogo.local` | `Customer12345!` | customer                 |

## Scripts

| Script                                                     | What it does                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                                              | API with reload (tsx)                                                     |
| `npm run build` / `npm start`                              | Generate the Prisma client, compile to `dist/`, run                       |
| `npm run typecheck`, `npm run lint`, `npm run format`      | Checks                                                                    |
| `npm test`                                                 | Unit tests; with `TEST_DATABASE_URL` set, also integration tests on MySQL |
| `npm run db:migrate`                                       | Create a migration from schema changes (needs a shadow database)          |
| `npm run db:deploy`, `npm run db:seed`, `npm run db:reset` | Apply migrations, seed, reset                                             |

Integration tests recreate the database from `TEST_DATABASE_URL` (its name must contain `test`):

```bash
TEST_DATABASE_URL=mysql://smachnogo:smachnogo@localhost:3306/smachnogo_test npm test
```

## Structure

```
src/
  app.ts, server.ts       # Express app and process entry point
  config/env.ts           # environment validation at startup
  lib/                    # prisma, logger, errors, geo, time (Europe/Kyiv), crypto, money, settings, mailer
  middleware/             # auth and roles, rate limit, error format
  modules/
    auth/                 # register, login, Google, refresh rotation, email verify, password reset
    users/                # /me
    catalog/              # public dictionaries, listing search, venue and listing pages
    partner/              # venue cabinet: offers, listings, orders, pickup
    orders/               # customer orders, reservation, voucher
    payments/             # payment gateway adapter (fake for now), payment result processing
  jobs/                   # expire reservations, close sales, mark no-shows
prisma/
  schema.prisma, migrations/, seed.ts
test/unit, test/integration
```

## API (base path `/api/v1`)

Errors: `{ "error": { "code", "message", "details?" } }`, messages in Ukrainian, codes stable in English.
Money is a string with two decimals, time is ISO 8601 UTC. Auth: `Authorization: Bearer <accessToken>`;
the refresh token is an httpOnly cookie `sg_rt`, and `/auth/refresh` and `/auth/logout` require the header `x-sg-csrf: 1`.

| Area           | Endpoints                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth           | `POST /auth/register`, `/login`, `/google`, `/refresh`, `/logout`, `/logout-all`, `/verify-email`, `/verify-email/resend`, `/forgot-password`, `/reset-password`                                                                  |
| Profile        | `GET/PATCH /me`, `PATCH /me/password`                                                                                                                                                                                             |
| Catalog        | `GET /cities`, `/categories`, `/tags`, `/allergens`, `/listings`, `/listings/:id`, `/listings/:id/nearby`, `/venues/:slug`, `/venues/:slug/listings`                                                                              |
| Orders         | `POST /orders` (`Idempotency-Key`), `GET /orders?status=active\|history`, `GET /orders/:publicId`, `GET /orders/:publicId/voucher`, `POST /orders/:publicId/pay`, `POST /orders/:publicId/cancel`                                 |
| Payments (dev) | `POST /payments/fake/:providerOrderId/confirm` `{ result: "success" \| "failure" }`                                                                                                                                               |
| Venue cabinet  | `GET /partner/venues`; under `/partner/venues/:venueId`: `offers` (CRUD, DELETE = archive), `listings` (list, create, PATCH, `close`, `cancel`), `orders`, `pickups/verify`, `orders/:publicId/pickup`, `orders/:publicId/cancel` |
| Service        | `GET /health`, `GET /ready`                                                                                                                                                                                                       |

Payment flow in development: `POST /orders` returns `payment.checkoutUrl`; POST to it (as the same user)
to simulate the provider callback, then `GET /orders/:publicId/voucher` returns the QR token and the 6-character code.

## Decisions that differ from TZ 1.1

- Two repositories (backend, frontend) instead of a pnpm monorepo. Shared types will come from an OpenAPI description.
- Coordinates are `lat`/`lng` DECIMAL with a B-tree index instead of `POINT SRID 4326` + SPATIAL INDEX:
  Prisma cannot create rows with a required `Unsupported("point")` column, and distances use plain
  haversine SQL so that any MySQL-compatible host works (deployment target is render.com).
- Idempotency keys of `POST /orders` are stored in `orders.idempotency_key` until Redis is added.
- Rate limits are in memory per process until Redis is added.
- Background jobs run inside the API process (`RUN_JOBS_IN_PROCESS=true`) until the BullMQ worker is added.
- `PaymentProvider` enum has an extra `fake` value for development; `fake` is refused in production.
- The reservation `UPDATE` sets `status` before `quantity_left`, because MySQL evaluates SET assignments left to right.

## Deployment (render.com)

`render.yaml` is a draft Blueprint: build `npm ci --include=dev && npm run build`, pre-deploy
`npx prisma migrate deploy`, health check `/health`. Render has no managed MySQL, so `DATABASE_URL`
points to an external MySQL 8 or to a MySQL private service with a disk. Free instances sleep when idle,
which pauses the in-process jobs. When the frontend is on another host, set `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`.

## Not done yet

LiqPay adapter and callback, Socket.io, Redis (BullMQ worker, shared rate limits), file uploads,
partner applications and onboarding, favorites, reviews, recommendations, admin panel, OpenAPI docs.
