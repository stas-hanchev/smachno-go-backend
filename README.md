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
| `npm run dev:worker` / `npm run start:worker`              | Background jobs worker (needs `REDIS_URL` for the BullMQ queue)           |
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
  lib/                    # prisma, logger, errors, geo, time (Europe/Kyiv), crypto, money, settings, mailer,
                          # audit log, after-commit effects, realtime emitter, slugs
  middleware/             # auth and roles, rate limit, error format
  realtime/socket.ts      # Socket.io server: handshake auth, rooms
  modules/
    auth/                 # register, login, Google, refresh rotation, email verify, password reset
    users/                # /me
    notifications/        # in-app notifications, email by notification settings
    catalog/              # public dictionaries, listing search, venue and listing pages
    favorites/            # favorite venues
    partner/              # applications, venue profile, hours, team and invites, offers, listings, pickup
    orders/               # customer orders, reservation, voucher, order events and emails
    payments/             # LiqPay and fake gateways, callback, status sync, payment result processing
    admin/                # applications, venues, users, orders, dictionaries, settings, audit log
  jobs/                   # expire reservations, close sales, no-shows, reminders, payment reconcile, token cleanup
prisma/
  schema.prisma, migrations/, seed.ts
test/unit, test/integration
```

## API (base path `/api/v1`)

Errors: `{ "error": { "code", "message", "details?" } }`, messages in Ukrainian, codes stable in English.
Money is a string with two decimals, time is ISO 8601 UTC. Auth: `Authorization: Bearer <accessToken>`;
the refresh token is an httpOnly cookie `sg_rt`, and `/auth/refresh` and `/auth/logout` require the header `x-sg-csrf: 1`.

| Area          | Endpoints                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | `POST /auth/register`, `/login`, `/google`, `/refresh`, `/logout`, `/logout-all`, `/verify-email`, `/verify-email/resend`, `/forgot-password`, `/reset-password`                                        |
| Profile       | `GET/PATCH /me`, `PATCH /me/password`, `GET /me/notifications?unread=`, `POST /me/notifications/read` `{ ids? }`, `GET/PATCH /me/notification-settings`                                                 |
| Catalog       | `GET /cities`, `/categories`, `/tags`, `/allergens`, `/listings`, `/listings/:id`, `/listings/:id/nearby`, `/venues/:slug`, `/venues/:slug/listings`                                                    |
| Favorites     | `GET /favorites`, `PUT /favorites/:venueId` `{ notifyNewListings? }`, `DELETE /favorites/:venueId`; catalog cards carry `isFavoriteVenue`                                                               |
| Orders        | `POST /orders` (`Idempotency-Key`), `GET /orders?status=active\|history`, `GET /orders/:publicId`, `GET /orders/:publicId/voucher`, `POST /orders/:publicId/pay`, `POST /orders/:publicId/cancel`       |
| Payments      | `POST /payments/liqpay/callback` (form `data`, `signature`), `GET/POST /payments/liqpay/return?orderId=`; dev only: `POST /payments/fake/:providerOrderId/confirm` `{ result: "success" \| "failure" }` |
| Partner       | `POST /partner/applications`, `GET /partner/applications/mine`, `POST /partner/invites/accept` `{ token }`, `GET /partner/venues`                                                                       |
| Venue cabinet | under `/partner/venues/:venueId`: `GET/PATCH` profile, `PUT hours`, `POST closures`, `DELETE closures/:id`, `POST activate`, `members` (list, `invite`, PATCH status, DELETE), `DELETE invites/:id`     |
|               | `offers` (CRUD, DELETE = archive), `listings` (list, create, PATCH, `close`, `cancel`), `orders`, `pickups/verify`, `orders/:publicId/pickup`, `orders/:publicId/cancel`                                |
| Admin         | under `/admin`: `applications` (list, get, `approve`, `reject`), `venues` (list, get, PATCH status and commission), `users` (list, get, PATCH status and role), `orders` (search, get, `refund`)        |
|               | `categories`, `tags`, `allergens`, `cities` (list, create, PATCH, DELETE), `GET/PUT settings`, `GET audit-log`                                                                                          |
| Service       | `GET /health`, `GET /ready`                                                                                                                                                                             |

Payment flow in development: `POST /orders` returns `payment.checkoutUrl`; POST to it (as the same user)
to simulate the provider callback, then `GET /orders/:publicId/voucher` returns the QR token and the 6-character code.

Roles: venue owners manage the profile, team, offers and cancellations; staff manage listings and pickups.
Admins see venue cabinets read-only. Only a super admin can grant or change admin roles. Every admin change
is written to `audit_log`.

### LiqPay

With `PAYMENT_PROVIDER=liqpay`, `payment` in the order response holds `checkoutUrl`, `data` and `signature`:
the frontend submits `data` and `signature` as a form POST to `https://www.liqpay.ua/api/3/checkout`
(or opens `checkoutUrl`). The checkout carries `expired_date` equal to the end of the reservation.

- LiqPay calls `POST {API_PUBLIC_URL}/api/v1/payments/liqpay/callback`. Every call is stored in `payment_webhook_log`;
  the signature, the public key, the amount and the currency are checked before the order changes. A repeated
  callback does not change the order and does not send emails again.
- After payment the browser comes to `/payments/liqpay/return`, which checks the status with the LiqPay API
  if no callback has arrived yet and redirects to `{APP_URL}/orders/:publicId?payment=return`.
- A payment that arrives after the reservation expired reserves the stock again or, if the sets are sold out,
  marks the order `refunded` and refunds the money (TZ 8.8).
- Refunds go through the LiqPay API on cancellation by the customer, by the venue, on listing cancellation
  and from the admin panel; each attempt is a row in `refunds`. The `reconcilePayments` job asks LiqPay for
  the status of payments without a final status (from 3 minutes to 24 hours old).
- For a sandbox, set `LIQPAY_SANDBOX=true` and sandbox keys. Callbacks need a public URL: a tunnel
  (`cloudflared tunnel --url http://localhost:4000`, then set `API_PUBLIC_URL`) or a render.com deploy.
  Without a tunnel, the return URL still finalizes the payment through the status API.

### Realtime (Socket.io)

Connect to the API origin with `auth: { token: <accessToken> }` (or without a token for public listing updates).
A user joins `user:<id>`, admins also join `admin`. Client events with acknowledgements:
`listing:subscribe` / `listing:unsubscribe` `{ listingIds }`, `venue:subscribe` / `venue:unsubscribe` `{ venueId }`
(active venue members and admins only).

| Event              | Room                         | Payload                                              |
| ------------------ | ---------------------------- | ---------------------------------------------------- |
| `listing:updated`  | `listing:<id>`, `venue:<id>` | `{ listingId, quantityLeft, quantityTotal, status }` |
| `order:status`     | `user:<id>`                  | `{ publicId, status }`                               |
| `order:new`        | `venue:<id>`                 | `{ publicId, status }` when an order is paid         |
| `order:updated`    | `venue:<id>`                 | `{ publicId, status }` after a paid order changes    |
| `notification:new` | `user:<id>`                  | notification as in `GET /me/notifications`           |
| `application:new`  | `admin`                      | `{ id, businessName, createdAt }`                    |

Events are published only after the database transaction commits (`publishAfterCommit`). One API instance
for now: several instances will need the Redis adapter.

### Notifications and jobs

Emails: payment and voucher, cancellation and refund, late payment refund, pickup reminder 30 minutes
before the window, staff invite, application decision. Order emails respect `notification_settings`
(`emailEnabled`, `orderUpdates`, `pickupReminders`); every notice is also stored in `notifications`.

Jobs: `expirePendingOrders`, `closeListingSales` and `remindPickup` every minute, `markNoShow` and
`reconcilePayments` every 5 minutes, `recomputeRecommendations` every hour, `cleanupTokens` every 6 hours.

Two modes:

- Without Redis (`REDIS_URL` empty, `RUN_JOBS_IN_PROCESS=true`): the API runs the jobs on timers, as before.
- With Redis (`REDIS_URL` set, `RUN_JOBS_IN_PROCESS=false`): `src/worker.ts` registers BullMQ job schedulers and
  runs every job once per tick across all workers; it sends Socket.io events through the Redis emitter. The API
  uses Redis for rate limits and the Socket.io adapter, so several API instances share limits and rooms.
  Do not run both modes at once, or jobs run twice. Locally: `REDIS_URL=redis://localhost:6379`, then
  `npm run dev` and `npm run dev:worker`.

### Photos (Cloudinary)

Owners upload images as `multipart/form-data` with one `file` field (JPEG, PNG or WebP, up to 5 MB; the
signature is checked, not the extension): `POST|DELETE /partner/venues/:venueId/logo`, `/cover`,
`POST /photos`, `DELETE /photos/:photoId` (up to 10), `POST|DELETE /offers/:offerId/photo`. Cloudinary limits
images to 2000 px, the stored URL serves `f_auto,q_auto`, and a replaced image is deleted from Cloudinary.
Without `CLOUDINARY_*` the routes answer 503.

### Recommendations

`GET /recommendations?lat&lng&radiusKm&limit` (up to 12) and `GET /recommendations/daily?lat&lng` score
available listings by the TZ 8.12 formula, keep at most two listings per venue and personalise after three
signals (view or stronger). `POST /interactions` takes `{ anonId?, events: [{ offerId, type: impression|view,
source?, position? }] }` (up to 50; guests need a ULID `anonId`). Reserve, purchase, pickup and favorite events
are written by the server. Weights: `GET/PUT /admin/settings/recommendations`.

### Service endpoints

`/health`, `/ready` (MySQL and Redis), `/metrics` (Prometheus, needs `Authorization: Bearer <METRICS_TOKEN>`,
404 otherwise), `/api/v1/openapi.json` (generated from the Express routes and celebrate schemas, so request
parameters and bodies match the validation; responses are not described yet). Errors with status 5xx and
failed jobs go to Sentry when `SENTRY_DSN` is set.

## Decisions that differ from TZ 1.1

- Two repositories (backend, frontend) instead of a pnpm monorepo. Shared types will come from an OpenAPI description.
- Coordinates are `lat`/`lng` DECIMAL with a B-tree index instead of `POINT SRID 4326` + SPATIAL INDEX:
  Prisma cannot create rows with a required `Unsupported("point")` column, and distances use plain
  haversine SQL so that any MySQL-compatible host works (deployment target is render.com).
- Idempotency keys of `POST /orders` are stored in `orders.idempotency_key` instead of Redis: they stay with the order.
- `PaymentProvider` enum has an extra `fake` value for development; `fake` is refused in production.
- The reservation `UPDATE` sets `status` before `quantity_left`, because MySQL evaluates SET assignments left to right.
- Staff invites are `auth_tokens` rows of type `staff_invite` (the inviter as `user_id`, the venue and email in `payload`),
  so a person without an account can be invited; the membership is created when the invite is accepted.
- An approved application creates a `draft` venue with the city center as coordinates unless the admin passes
  `lat`/`lng`; the owner corrects the address and coordinates in the profile before activation.
- `orders.reminder_sent_at` was added so that the pickup reminder is sent once.
- Photos are stored in Cloudinary instead of S3/MinIO and uploaded through the API (multer, signature check)
  instead of `/uploads/presign`; Cloudinary resizes and re-encodes, so `sharp` is not used.
- Rate limits and Socket.io use Redis only when `REDIS_URL` is set; without it they stay in memory per process.
- Guests' interactions are kept under their `anonId` and are not merged into the account after sign-in.
- A favorite venue is recorded as `favorite` interactions on its active offers (up to five), because
  `interactions.offer_id` is required.

## Deployment (render.com)

`render.yaml` is a Blueprint with three services: `smachnogo-api` (web, pre-deploy `npx prisma migrate deploy`,
health check `/health`), `smachnogo-worker` (background worker) and `smachnogo-redis` (Key Value). Shared
variables live in the `smachnogo-shared` group. Render has no managed MySQL, so `DATABASE_URL` points to an
external MySQL 8 or to a MySQL private service with a disk. When the frontend is on another host, keep
`COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`. Set `API_PUBLIC_URL` to the public URL of the service, because
LiqPay sends callbacks and redirects there.

The Blueprint runs payments on the test provider: `PAYMENT_PROVIDER=fake` is refused with
`NODE_ENV=production` unless `ALLOW_FAKE_PAYMENTS=true`, which is meant for staging only. For LiqPay set
`PAYMENT_PROVIDER=liqpay`, the keys and `ALLOW_FAKE_PAYMENTS=false`.

## Not done yet

Response schemas in OpenAPI, scheduled listings (`generateListings`, FR021) and the rest of stage 2 of the TZ
(reviews, analytics, gamification, web push, settlements).
