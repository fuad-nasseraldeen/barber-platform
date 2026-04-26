# Deploy Backend to Render

## 1. Connect Repository

1. Go to [render.com](https://render.com) and sign in
2. **New** → **Web Service**
3. Connect your GitHub repository (`barber-platform` or `new-barber`)

## 2. Configure Project

| Setting | Value |
|---------|-------|
| **Name** | `barber-platform-api` (or your choice) |
| **Region** | Frankfurt or Oregon (match your DB/Redis) |
| **Root Directory** | `barber-platform/backend` (or `backend` if repo root is barber-platform) |
| **Runtime** | Node |
| **Build Command** | `npm install && npx prisma generate && npm run build` |
| **Start Command** | `npm run start:prod` |

⚠️ **Root Directory:** Must point to the `backend` folder (monorepo).

## 3. Instance Type

| Tier | RAM | CPU | Notes |
|------|-----|-----|-------|
| Free | 512 MB | 0.1 | Spins down after inactivity; dev only |
| Starter ($7/mo) | 512 MB | 0.5 | Recommended for production |
| Standard ($25/mo) | 2 GB | 1 | Better for production load |

## 4. Environment Variables

Add in Render → Environment:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✓ | PostgreSQL (pooler OK for app) |
| `DIRECT_URL` | ✓ | Direct Postgres URI for Prisma migrations (Supabase `db.*.supabase.co`) |
| `JWT_SECRET` | ✓ | Strong random string |
| `REDIS_URL` | ✓* | Redis URL (`rediss://...` for Upstash) |
| `REDIS_HOST` | ✓* | Redis host |
| `REDIS_PORT` | ✓* | Redis port |
| `REDIS_PASSWORD` | ✓* | Redis password |
| `REDIS_TLS` | ✓* | `true` for Upstash |
| `GOOGLE_CLIENT_ID` | ✓ | Google OAuth |
| `SUPABASE_URL` | ✓ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Supabase service role key |
| `SUPABASE_BUCKET` | ✓ | Storage bucket name |
| `NODE_ENV` | ✓ | `production` |
| `PORT` | ✓ | `3000` (Render sets this automatically) |
| `APP_URL` | ✓ | Frontend URL (e.g. Vercel) |
| `CORS_ORIGIN` | ✓ | Frontend origin(s), e.g. `https://your-app.vercel.app` |
| `STRIPE_SECRET_KEY` | If payments | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | If webhooks | Stripe webhook secret |
| `SMS_TO_API_KEY` | If SMS | sms.to API key |

\* Use `Add from .env` to import from your local `.env`, then update secrets.

## 5. Deploy

Click **Deploy Web Service**. Render will build and start the API.

## 6. Run Migrations

Add a one-off deploy hook or run manually:

```bash
npx prisma migrate deploy
```

Or add to Build Command:

```
npm install && npx prisma generate && npm run build && npx prisma migrate deploy
```

## 7. After Deploy

1. Copy the Render URL (e.g. `https://barber-platform-api.onrender.com`)
2. Set `NEXT_PUBLIC_API_URL` in Vercel to this URL
3. Add Render URL to backend `CORS_ORIGIN` if needed
