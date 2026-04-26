import * as path from 'path';
import * as fs from 'fs';

export function loadBackendEnv(): void {
  try {
    require('dotenv');
  } catch {
    // dotenv already loaded via wrapper or not available
  }
  const backendRoot = path.resolve(__dirname, '..', '..', '..');
  const envPath = path.join(backendRoot, '.env');
  const localPath = path.join(backendRoot, '.env.local');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
  if (fs.existsSync(localPath)) {
    require('dotenv').config({ path: localPath, override: true });
  }
}

function strip(s: string | undefined): string {
  return (s ?? '').trim().replace(/^Bearer\s+/i, '');
}

export function getRequiredEnv(): {
  businessId: string;
  authToken: string;
  baseUrl: string;
  apiPrefix: string;
  databaseUrl: string;
} {
  const businessId = (
    process.env.BUSINESS_ID ??
    process.env.TEST_BUSINESS_ID ??
    ''
  ).trim();
  const authToken = strip(
    process.env.AUTH_TOKEN ?? process.env.K6_AUTH_TOKEN ?? '',
  );
  const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').trim();
  const apiPrefix = (process.env.API_PREFIX || 'api/v1').trim();
  const databaseUrl = (process.env.DATABASE_URL || '').trim();

  if (!businessId) throw new Error('BUSINESS_ID required');
  if (!authToken) throw new Error('AUTH_TOKEN required');
  if (!databaseUrl) throw new Error('DATABASE_URL required');

  return { businessId, authToken, baseUrl, apiPrefix, databaseUrl };
}

export function intEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Re-sign the existing AUTH_TOKEN with a long TTL (2h) so property / longrun
 * tests don't fail mid-suite when the original 15m token expires.
 * Falls back to the original token if jwt is unavailable or payload is invalid.
 */
export function mintLongLivedTestToken(shortToken: string): string {
  try {
    const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
    const secret = (process.env.JWT_SECRET ?? '').trim();
    if (!secret) return shortToken;
    const decoded = jwt.decode(shortToken);
    if (!decoded || typeof decoded !== 'object') return shortToken;
    const { iat: _iat, exp: _exp, nbf: _nbf, ...payload } = decoded as Record<string, unknown>;
    return jwt.sign(payload, secret, { expiresIn: '2h' });
  } catch {
    return shortToken;
  }
}
