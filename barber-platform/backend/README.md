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

See [docs/RENDER_DEPLOY.md](docs/RENDER_DEPLOY.md) for Render deployment.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Auth](docs/AUTH.md)
- [Migrations](docs/MIGRATIONS.md)
- [Employee Permissions](docs/EMPLOYEE_PERMISSIONS.md)
- [Schema Design](docs/SCHEMA_DESIGN.md)
- [Performance](docs/PERFORMANCE_ARCHITECTURE.md)
