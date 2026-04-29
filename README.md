# תורן — Barber Shop SaaS Platform

Production-grade SaaS platform for service-based businesses: barber shops, beauty salons, gyms, and clinics.

## Project Structure

```
new-barber/
└── barber-platform/
    ├── backend/          # NestJS API (port 3000)
    └── admin-dashboard/  # Next.js admin UI (port 3001)
```

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Backend** | NestJS, TypeScript, Prisma, PostgreSQL (Supabase), Redis (Upstash), BullMQ, Stripe, Supabase Storage |
| **Admin Dashboard** | Next.js 16, React 19, Tailwind CSS, TanStack Query, Zustand, FullCalendar |

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (Supabase recommended) & Redis (Upstash recommended)
- npm

### 1. Backend

```bash
cd barber-platform/backend
npm install
cp .env.example .env   # Configure DATABASE_URL, DIRECT_URL, REDIS_*, etc.
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

Backend runs at **http://localhost:3000**

### 2. Admin Dashboard

```bash
cd barber-platform/admin-dashboard
npm install
cp .env.local.example .env.local   # Set NEXT_PUBLIC_API_URL, NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm run dev
```

Admin dashboard runs at **http://localhost:3001**

### 3. Run Both

Open two terminals:

```bash
# Terminal 1 — Backend
cd barber-platform/backend && npm run start:dev

# Terminal 2 — Admin Dashboard
cd barber-platform/admin-dashboard && npm run dev
```

The admin dashboard proxies `/api/v1/*` to the backend. **Both must be running** for login and API calls to work.

## Environment

### Backend (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✓ | PostgreSQL connection (Supabase pooler) |
| `DIRECT_URL` | ✓ | Direct connection for Prisma migrations |
| `REDIS_URL` / `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS` | ✓* | Redis (Upstash) |
| `JWT_SECRET` | ✓ | Auth signing key |
| `GOOGLE_CLIENT_ID` | ✓ | Google OAuth |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | ✓ | Supabase Storage |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | If payments | Stripe |
| `SMS_TO_API_KEY` | If SMS | sms.to for OTP |
| `APP_URL`, `CORS_ORIGIN` | Prod | Frontend URL for CORS |

\* Redis can be disabled in dev with `ENABLE_REDIS=false` if supported.

### Admin Dashboard (`.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | ✓ | Backend URL (default: `http://localhost:3000`) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | ✓ | Google Sign-In |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Optional | Address autocomplete |

## Build & Deploy

### Local Build (verify before deploy)

```bash
# Admin Dashboard
cd barber-platform/admin-dashboard && npm run build

# Backend
cd barber-platform/backend && npm run build
```

### Deployment

| App | Platform | Doc |
|-----|----------|-----|
| Admin Dashboard | Vercel | [VERCEL_DEPLOY.md](barber-platform/admin-dashboard/VERCEL_DEPLOY.md) |
| Backend API | Render | [RENDER_DEPLOY.md](barber-platform/backend/docs/RENDER_DEPLOY.md) |

> **Note:** If your repo root is `barber-platform`, use Root Directory `backend` for Render. If repo root is `new-barber`, use `barber-platform/backend`.

## Features

- **Multi-tenant** — Businesses, branches, staff, services
- **Appointments** — FullCalendar day/week view, staff resources, breaks, vacation
- **Staff management** — Roles, permissions, breaks, time-off
- **Customers** — Profiles, booking history
- **Availability** — Working hours, slots, real-time updates
- **i18n** — Hebrew, English, Arabic

## Documentation

- [Backend Architecture](barber-platform/backend/docs/ARCHITECTURE.md)
- [Auth](barber-platform/backend/docs/AUTH.md)
- [Migrations](barber-platform/backend/docs/MIGRATIONS.md)
- [Employee Permissions](barber-platform/backend/docs/EMPLOYEE_PERMISSIONS.md)
- [Schema Design](barber-platform/backend/docs/SCHEMA_DESIGN.md)
- [Performance Architecture](barber-platform/backend/docs/PERFORMANCE_ARCHITECTURE.md)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 3001 in use | Run `netstat -ano` to find PID, then `taskkill /PID <pid> /F` |
| ECONNREFUSED on login | Start the backend (`npm run start:dev` in `backend/`) |
| FullCalendar errors | Admin dashboard uses dynamic import with `ssr: false` |
| Backend ENOTEMPTY on Windows | `deleteOutDir: false` in `nest-cli.json`; use `npm run clean` for fresh build |
| Build memory errors | Add `NODE_OPTIONS=--max-old-space-size=4096` (Build only) in Vercel |

## Run Test
npm run k6:correctness