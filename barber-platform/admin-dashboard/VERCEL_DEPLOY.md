# Deploy Admin Dashboard to Vercel

## 1. Connect Repository

1. Go to [vercel.com](https://vercel.com) and sign in
2. **Add New** → **Project**
3. Import your Git repository (`new-barber` or `barber-platform`)

## 2. Configure Project

| Setting | Value |
|---------|-------|
| **Framework Preset** | Next.js (auto-detected) |
| **Root Directory** | `barber-platform/admin-dashboard` |
| **Build Command** | `npm run build` |
| **Output Directory** | (leave default) |
| **Install Command** | `npm install` |

⚠️ **Important:** Set **Root Directory** to `barber-platform/admin-dashboard` (monorepo).

## 3. Environment Variables

Add in Vercel → Project → Settings → Environment Variables:

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | ✓ | Backend API URL (Railway backend service) | `https://your-backend.up.railway.app` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | ✓ | Google OAuth Client ID | `xxx.apps.googleusercontent.com` |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Optional | Address autocomplete | `AIza...` |
| `NODE_OPTIONS` | Build only | Memory for build | `--max-old-space-size=4096` |

**Note:** Until the backend is deployed, use a placeholder for `NEXT_PUBLIC_API_URL`. The app will load but API calls will fail until the backend is live.

## 4. Deploy

Click **Deploy**. First build may take 2–3 minutes.

## 5. After Backend is Deployed

1. Update `NEXT_PUBLIC_API_URL` in Vercel to your Railway backend URL.
2. Redeploy (or auto-redeploy on next push)
3. In Railway backend variables, set `CORS_ORIGIN` with your Vercel domains (comma-separated)

---

## Troubleshooting Build Errors

### "Call retries were exceeded" / WorkerError

- Add `NODE_OPTIONS` = `--max-old-space-size=4096` (Build only) in Environment Variables
- Check build logs for the actual error above the retry message

### "Can't resolve '@fullcalendar/core/preact.js'"

- The project uses `dynamic` import with `ssr: false` for FullCalendar
- Ensure Root Directory is `barber-platform/admin-dashboard`

### Verify build locally

```bash
cd barber-platform/admin-dashboard && npm run build
```
