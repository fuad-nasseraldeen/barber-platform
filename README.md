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
| **Backend** | NestJS, TypeScript, Prisma, PostgreSQL (Supabase), Redis, BullMQ, Stripe |
| **Admin Dashboard** | Next.js 16, React 19, Tailwind CSS, TanStack Query, Zustand, FullCalendar |

## Quick Start

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL & Redis, or use Supabase)
- npm

### 1. Backend

```bash
cd barber-platform/backend
npm install
cp .env.example .env   # Configure DATABASE_URL, etc.
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

Backend runs at **http://localhost:3000**

### 2. Admin Dashboard

```bash
cd barber-platform/admin-dashboard
npm install
cp .env.local.example .env.local   # Set NEXT_PUBLIC_API_URL if needed
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

- `DATABASE_URL` — PostgreSQL connection (Supabase pooler)
- `DIRECT_URL` — Direct connection for migrations
- `REDIS_HOST`, `REDIS_PORT` — Redis (optional for dev)
- `JWT_SECRET` — Auth signing key
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth (optional)

### Admin Dashboard (`.env.local`)

- `NEXT_PUBLIC_API_URL` — Backend URL (default: `http://localhost:3000`)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — For Google Sign-In

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

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 3001 in use | Run `netstat -ano` to find PID, then `taskkill /PID <pid> /F` |
| ECONNREFUSED on login | Start the backend (`npm run start:dev` in `backend/`) |
| FullCalendar errors | Admin dashboard uses `--webpack` and dynamic import for FullCalendar |
