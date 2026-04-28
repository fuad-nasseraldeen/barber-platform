# Admin Dashboard — תורן

Next.js 16 admin dashboard for the Barber Shop SaaS platform. Multi-tenant UI for businesses, staff, appointments, customers, and analytics.

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19**, TypeScript
- **Tailwind CSS 4**
- **TanStack Query** (data fetching, caching)
- **Zustand** (state)
- **FullCalendar** (appointments, resource-timegrid)
- **Recharts** (analytics)

## Getting Started

### Prerequisites

- Node.js 18+
- Backend API running (see [backend README](../backend/README.md))

### 1. Install & Run

```bash
npm install
```

Create `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_MAPS_KEY=AIza...   # optional, for address autocomplete
```

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

### 2. Build (production)

```bash
npm run build
npm run start
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Development server (port 3001, webpack) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |

## Project Structure

```
admin-dashboard/
├── src/
│   ├── app/              # App Router pages
│   │   ├── admin/        # Admin dashboard
│   │   ├── employee/     # Employee dashboard
│   │   ├── staff/        # Staff portal
│   │   └── login/        # Auth
│   ├── components/
│   ├── lib/              # API client, i18n, utils
│   └── types/
├── public/
└── next.config.ts
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | ✓ | Backend API base URL |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | ✓ | Google OAuth Client ID |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Optional | Google Maps API key (address autocomplete) |

## Deployment

See [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md) for Vercel deployment.

## i18n

Hebrew, English, Arabic supported. Translation keys in `src/lib/i18n.ts`. See [NOTIFICATIONS_I18N.md](./docs/NOTIFICATIONS_I18N.md) for notification i18n.
