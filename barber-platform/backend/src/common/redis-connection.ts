import type { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

type RedisScope =
  | 'cache'
  | 'queue.notification'
  | 'queue.analytics'
  | 'queue.automation'
  | 'worker.notification'
  | 'worker.automation'
  | 'notification.service';

type RedisResolvedConfig = {
  options: RedisOptions & { lazyConnect?: boolean };
  debug: {
    scope: RedisScope;
    usingURL: boolean;
    host: string;
    port: number;
    username: string | null;
    hasPassword: boolean;
    tls: boolean;
    family: number | undefined;
    connectTimeout: number | undefined;
    envSource: {
      url: string | null;
      host: string | null;
      port: string | null;
      username: string | null;
      passwordFrom: 'url' | 'env' | 'none';
      tlsFrom: 'url' | 'env' | 'default';
    };
  };
};

const loggedScopes = new Set<string>();

function firstNonEmpty(values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function getConfigValue(config: ConfigService, ...keys: string[]): string | null {
  return firstNonEmpty(keys.map((key) => config.get<string>(key)));
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveRedisConnection(
  config: ConfigService,
  scope: RedisScope,
  extra: Partial<RedisOptions & { lazyConnect?: boolean }> = {},
): RedisResolvedConfig {
  const rawUrl = getConfigValue(config, 'REDIS_URL', 'REDIS_PUBLIC_URL');
  const parsedUrl = rawUrl ? new URL(rawUrl) : null;

  const host = parsedUrl?.hostname ?? getConfigValue(config, 'REDIS_HOST', 'REDISHOST') ?? 'localhost';
  const port = parsedUrl?.port
    ? parsePositiveInt(parsedUrl.port, 6379)
    : parsePositiveInt(getConfigValue(config, 'REDIS_PORT', 'REDISPORT'), 6379);
  const username = parsedUrl?.username || getConfigValue(config, 'REDIS_USER', 'REDISUSER');
  const passwordFromUrl = parsedUrl?.password ?? null;
  const passwordFromEnv = getConfigValue(config, 'REDIS_PASSWORD', 'REDISPASSWORD');
  const password = passwordFromUrl || passwordFromEnv || undefined;
  const tlsFromEnv = getConfigValue(config, 'REDIS_TLS') === 'true';
  const tls = parsedUrl?.protocol === 'rediss:' || tlsFromEnv;
  const family = parsePositiveInt(getConfigValue(config, 'REDIS_FAMILY'), 4);
  const connectTimeout = parsePositiveInt(getConfigValue(config, 'REDIS_CONNECT_TIMEOUT_MS'), 15000);

  const options: RedisOptions & { lazyConnect?: boolean } = {
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(tls ? { tls: {} } : {}),
    family,
    connectTimeout,
    lazyConnect: extra.lazyConnect,
    ...extra,
  };

  return {
    options,
    debug: {
      scope,
      usingURL: Boolean(rawUrl),
      host,
      port,
      username: username || null,
      hasPassword: Boolean(password),
      tls,
      family,
      connectTimeout,
      envSource: {
        url: rawUrl,
        host: getConfigValue(config, 'REDIS_HOST', 'REDISHOST'),
        port: getConfigValue(config, 'REDIS_PORT', 'REDISPORT'),
        username: getConfigValue(config, 'REDIS_USER', 'REDISUSER'),
        passwordFrom: passwordFromUrl ? 'url' : passwordFromEnv ? 'env' : 'none',
        tlsFrom: parsedUrl?.protocol === 'rediss:' ? 'url' : tlsFromEnv ? 'env' : 'default',
      },
    },
  };
}

export function logRedisConnectionConfig(resolved: RedisResolvedConfig): void {
  const key = `${resolved.debug.scope}:${resolved.debug.host}:${resolved.debug.port}`;
  if (loggedScopes.has(key)) return;
  loggedScopes.add(key);

  try {
    process.stdout.write(
      `${JSON.stringify({
        type: 'redis_config',
        scope: resolved.debug.scope,
        usingURL: resolved.debug.usingURL,
        host: resolved.debug.host,
        port: resolved.debug.port,
        usernamePresent: Boolean(resolved.debug.username),
        hasPassword: resolved.debug.hasPassword,
        tls: resolved.debug.tls,
        family: resolved.debug.family,
        connectTimeout: resolved.debug.connectTimeout,
        envSource: {
          urlPresent: Boolean(resolved.debug.envSource.url),
          hostPresent: Boolean(resolved.debug.envSource.host),
          portPresent: Boolean(resolved.debug.envSource.port),
          usernamePresent: Boolean(resolved.debug.envSource.username),
          passwordFrom: resolved.debug.envSource.passwordFrom,
          tlsFrom: resolved.debug.envSource.tlsFrom,
        },
      })}\n`,
    );
  } catch {
    /* ignore */
  }
}
