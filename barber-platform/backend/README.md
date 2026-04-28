# Barbershop SaaS Platform — Backend

Production-grade NestJS API for the multi-tenant barber shop SaaS platform.

## Tech Stack

- **NestJS 10**, TypeScript
- **Prisma ORM**, PostgreSQL (Supabase)
- **Redis** (Upstash), BullMQ
- **Stripe**, Supabase Storage
- **Passport** (JWT, Google OAuth)
- **Swagger** (API docs)

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (Supabase recommended)
- Redis (Upstash recommended, or local)

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL (often Supabase **pooler** for the running app) |
| `DIRECT_URL` | Supabase **direct** `db.*.supabase.co:5432` — required for `prisma migrate` when `DATABASE_URL` uses the pooler |
| `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS` | Redis |
| `JWT_SECRET` | JWT signing key |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | Supabase Storage |

### 3. Database

```bash
npm run prisma:generate
npm run prisma:migrate
# Optional: npm run prisma:seed
```

### 4. Run

```bash
npm run start:dev
```

API runs at **http://localhost:3000**. Swagger at `http://localhost:3000/api` (if enabled).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Development with watch |
| `npm run start:prod` | Production (`node dist/main`) |
| `npm run build` | Build for production |
| `npm run clean` | Remove `dist/` (fresh build) |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Run migrations (dev) |
| `npm run prisma:migrate:prod` | Run migrations (prod) |
| `npm run prisma:studio` | Prisma Studio |
| `npm run prisma:seed` | Seed database |

## Windows / ENOTEMPTY

On Windows, `nest start --watch` may fail with `ENOTEMPTY: directory not empty, rmdir dist/prisma`. This is fixed by setting `deleteOutDir: false` in `nest-cli.json`. For a clean build:

```bash
npm run clean && npm run build
```

## Deployment

### Railway (Backend only)

This repository is a monorepo. Railway should deploy **only** the backend service.

1. Create Railway project/service from this repository.
2. Keep service root at repository root (the root has `railway.toml` and `nixpacks.toml` that force backend-only build).
3. Set required backend environment variables (`DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, Redis variables, etc.).
4. Set `CORS_ORIGIN` to your Vercel admin domains (comma-separated), for example:

```bash
CORS_ORIGIN=https://your-admin.vercel.app,https://admin.yourdomain.com
```

Build/start are already configured to run only `backend/`:

- Install: `npm ci --prefix backend`
- Build: `npm run --prefix backend build`
- Start: `npm run --prefix backend start:prod`

If you still use Render, see [docs/RENDER_DEPLOY.md](docs/RENDER_DEPLOY.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Auth](docs/AUTH.md)
- [Migrations](docs/MIGRATIONS.md)
- [Employee Permissions](docs/EMPLOYEE_PERMISSIONS.md)
- [Schema Design](docs/SCHEMA_DESIGN.md)
- [Performance](docs/PERFORMANCE_ARCHITECTURE.md)

## Appointment Create Diagnostics

Diagnostic-only tooling for `POST /api/v1/appointments/create` latency analysis.

### Commands

```bash
npm run diag:db-latency
npm run diag:tx-latency
npm run diag:booking-sql
npm run diag:db-schema
```

### Run Locally (Israel laptop -> Supabase Paris)

1. Ensure `backend/.env` points to the same Supabase DB used by backend (`DATABASE_URL`).
2. Run diagnostics from backend folder:

```bash
npm run diag:db-latency
npm run diag:tx-latency
npm run diag:booking-sql
npm run diag:db-schema
```

### Run On Railway (Amsterdam runtime -> Supabase Paris)

Use Railway shell/exec on the deployed backend service and run the same commands:

```bash
npm run diag:db-latency
npm run diag:tx-latency
npm run diag:booking-sql
npm run diag:db-schema
```

### Compare These Metrics

- `diag:db-latency`: `SELECT 1` sequential/concurrent and simple `findFirst` baselines.
- `diag:tx-latency`: empty tx vs tx with 1/3/10 selects.
- `APPOINTMENT_CREATE_TIMING.queryTrace`: per-query order in create flow:
  - `phaseName`
  - `model`
  - `action`
  - `durationMs`
  - `cumulativeTxMs`
  - `insideTransaction`
- `APPOINTMENT_CREATE_DB_WAIT_DIAGNOSTICS`: `pg_stat_activity` wait samples + `pg_blocking_pids`.
- `diag:booking-sql`: `EXPLAIN ANALYZE` plans for key booking-related queries.
- `diag:db-schema`: indexes/constraints/triggers/FKs on `appointments`, `slot_holds`, `time_slots`.

### Interpretation Guide

- `SELECT 1 avg` high: network path / DB connectivity / pooler path issue.
- transaction baseline high: Prisma transaction overhead / pooler / DB transaction setup overhead.
- one query very high in `queryTrace`: lock wait, missing index, constraint/trigger heavy path, or slow plan.
- many small queries high cumulatively: round-trip accumulation due to query count.
