# Authentication System

## Overview

- **Phone OTP**: 6-digit code, 5 min expiry, rate limited, stored hashed in Redis
- **Google OAuth**: ID token verification (client sends credential from Google Sign-In)

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/request-otp` | Request OTP (sends SMS) |
| POST | `/api/v1/auth/verify-otp` | Verify OTP, get JWT + refresh token |
| POST | `/api/v1/auth/google` | Google Sign-In, get JWT + refresh token |
| POST | `/api/v1/auth/logout` | Revoke refresh token (optional body: `{ refreshToken }`) |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/link-google` | Link Google to existing account (JWT required) |
| POST | `/api/v1/auth/link-phone` | Link phone to existing account (JWT required) |

## Request/Response Examples

### Request OTP
```json
POST /api/v1/auth/request-otp
{ "phone": "+1234567890" }
→ { "success": true }
```

### Verify OTP
```json
POST /api/v1/auth/verify-otp
{ "phone": "+1234567890", "code": "123456", "firstName": "John", "lastName": "Doe" }
→ { "accessToken": "...", "refreshToken": "...", "expiresIn": 900, "user": {...} }
```

### Google Auth
```json
POST /api/v1/auth/google
{ "credential": "<google-id-token>" }
→ { "accessToken": "...", "refreshToken": "...", "expiresIn": 900, "user": {...} }
```

### Logout
```json
POST /api/v1/auth/logout
{ "refreshToken": "..." }
→ { "success": true }
```

### Refresh
```json
POST /api/v1/auth/refresh
{ "refreshToken": "..." }
→ { "accessToken": "...", "refreshToken": "...", "expiresIn": 900, "user": {...} }
```

## Security

- **Phone validation**: E.164 format (`+[1-9][6-14 digits]`)
- **OTP**: 6 digits, 5 min TTL, SHA-256 hashed in Redis
- **Rate limiting**: 3 OTP requests/min per phone, 5 verify attempts/min
- **Verify attempts**: Max 5 wrong codes per 5 min, then must request new OTP
- **Throttling**: Global + per-route limits via `@nestjs/throttler`

## Environment

```
JWT_SECRET=...
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
SMS_TO_API_KEY=...
```

## Migration

Run `npx prisma migrate dev` to apply the auth schema changes (phone, phoneVerified on users).
