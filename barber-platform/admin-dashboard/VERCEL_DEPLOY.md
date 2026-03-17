# Deploy Admin Dashboard to Vercel

## 1. Connect Repository

1. Go to [vercel.com](https://vercel.com) and sign in
2. **Add New** → **Project**
3. Import your Git repository (`new-barber`)

## 2. Configure Project

| Setting | Value |
|---------|-------|
| **Framework Preset** | Next.js (auto-detected) |
| **Root Directory** | `barber-platform/admin-dashboard` |
| **Build Command** | `npm run build` |
| **Output Directory** | (leave default) |
| **Install Command** | `npm install` |

⚠️ **Important:** Set **Root Directory** to `barber-platform/admin-dashboard` (the project is in a monorepo).

## 3. Environment Variables

Add these in Vercel → Project → Settings → Environment Variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL (required for API calls) | `https://your-backend.railway.app` or `https://api.yourdomain.com` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth Client ID (for login) | `xxx.apps.googleusercontent.com` |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google Maps API key (optional, for address autocomplete) | `AIza...` |

**Note:** Until the backend is deployed, use a placeholder for `NEXT_PUBLIC_API_URL` (e.g. your future Railway/Render URL). The app will load but API calls will fail until the backend is live.

## 4. Deploy

Click **Deploy**. Vercel will build and deploy. The first build may take 2–3 minutes.

## 5. After Backend is Deployed

1. Update `NEXT_PUBLIC_API_URL` in Vercel to your production backend URL
2. Redeploy (or it will auto-redeploy on next push)
3. Add your Vercel domain to backend CORS if needed

---

## Troubleshooting Build Errors

### "Call retries were exceeded" / WorkerError

- **Fix applied:** `turbopack: {}` added to `next.config.ts` to silence webpack/Turbopack conflict
- If build still fails: In Vercel → Settings → Environment Variables, add `NODE_OPTIONS` = `--max-old-space-size=4096` (Build only)
- Check build logs for the actual error above the retry message

### "Can't resolve '@fullcalendar/core/preact.js'"

- The project uses `dynamic` import with `ssr: false` for FullCalendar to avoid this
- If it still occurs, ensure Root Directory is set to `barber-platform/admin-dashboard`
