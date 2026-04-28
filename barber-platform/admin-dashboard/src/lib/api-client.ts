import { useAuthStore } from "@/stores/auth-store";

const prefix = process.env.NEXT_PUBLIC_API_PREFIX || "api/v1";
const base = process.env.NEXT_PUBLIC_API_URL;

/** API paths (prefixed with /api/v1 by API_BASE). Use these for apiClient calls. */
export const API_PATHS = {
  AUTH_GOOGLE: "/auth/google",
} as const;

const API_BASE =
  typeof window !== "undefined" && (!base || base === "")
    ? `/${prefix}`
    : (base || "http://localhost:3000") + "/" + prefix;

const AUTH_REFRESH_PATH = "/auth/refresh";

export function getApiBase(): string {
  return API_BASE;
}

export function getUploadsBase(): string {
  if (typeof window === "undefined") return "";
  const b = process.env.NEXT_PUBLIC_API_URL;
  if (!b || b === "") return "";
  return b || "http://localhost:3000";
}

export type ApiError = {
  statusCode: number;
  message: string | string[];
  error?: string;
  /** From API when safe client message was mapped (see backend client-error-response). */
  clientCode?: string;
  /** Backend conflict / booking-lock code (e.g. SLOT_ALREADY_BOOKED, SLOT_JUST_TAKEN). */
  code?: string;
};

/** Thrown on failed fetch so callers can use `clientCode` + i18n. */
export class ApiRequestError extends Error {
  readonly statusCode: number;
  readonly clientCode?: string;

  constructor(message: string, statusCode: number, clientCode?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.statusCode = statusCode;
    this.clientCode = clientCode;
  }
}

/** Matches backend `CLIENT_ERROR_CODES` for i18n keys. */
const CLIENT_ERROR_I18N_KEYS: Record<string, string> = {
  BOOKING_INVALID_REQUEST: "errors.bookingInvalidRequest",
  SLOT_ALREADY_BOOKED: "errors.slotTaken",
  SLOT_JUST_TAKEN: "errors.slotTaken",
  VALIDATION_GENERIC: "errors.validationGeneric",
};

/** Map API errors (with optional `clientCode`) to a translated message. */
export function translateApiRequestError(
  error: unknown,
  t: (key: string) => string,
  fallbackMessage: string,
): string {
  if (error instanceof ApiRequestError) {
    const key = error.clientCode ? CLIENT_ERROR_I18N_KEYS[error.clientCode] : undefined;
    if (key) return t(key);
    return error.message || fallbackMessage;
  }
  if (error instanceof Error) return error.message || fallbackMessage;
  return fallbackMessage;
}

/** True when the backend rejected a slot-hold or booking because another client took the slot. */
export function isSlotConflictError(e: unknown): boolean {
  if (!(e instanceof ApiRequestError)) return false;
  if (e.statusCode !== 409) return false;
  const c = e.clientCode;
  return c === "SLOT_ALREADY_BOOKED" || c === "SLOT_JUST_TAKEN";
}

export type AuthSuccessResponse = {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    phone?: string;
    email?: string;
    name?: string;
    businessId?: string;
    role?: string;
    staffId?: string;
  };
  redirectTo?: "admin" | "staff" | "register-shop" | "register-staff";
};

function mapUser(u: AuthSuccessResponse["user"]) {
  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    name: u.name,
    businessId: u.businessId,
    role: (u.role as "owner" | "manager" | "staff" | "customer") ?? "customer",
    staffId: u.staffId,
  };
}

function clearAuthAndRedirect() {
  if (typeof window === "undefined") return;
  useAuthStore.getState().clearSession();
  void fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).catch(() => {});
  window.location.href = "/login";
}

/** No server call — use when refresh already failed (e.g. API down) to avoid another Failed to fetch. */
function clearClientSessionAndGoLogin(query?: string) {
  if (typeof window === "undefined") return;
  useAuthStore.getState().clearSession();
  const q = query ? `?${query}` : "";
  window.location.replace(`/login${q}`);
}

function isPublicAuthRoute(): boolean {
  if (typeof window === "undefined") return true;
  const p = window.location.pathname;
  return p === "/login" || p.startsWith("/register");
}

/** One in-flight refresh — concurrent 401s must not rotate the refresh token multiple times. */
let refreshInFlight: Promise<string | null> | null = null;

async function runRefreshOnce(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}${AUTH_REFRESH_PATH}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      clearAuthAndRedirect();
      return null;
    }

    const data = (await res.json()) as AuthSuccessResponse;
    useAuthStore.getState().setAuth(mapUser(data.user), data.accessToken);
    return data.accessToken;
  } catch {
    /** Network / CORS / wrong API URL — must not reject (avoids Next dev overlay + broken in-flight refresh). */
    clearAuthAndRedirect();
    return null;
  }
}

async function tryRefreshToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      return await runRefreshOnce();
    } catch {
      clearAuthAndRedirect();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Called once after persisted state rehydrates: restore access JWT from HttpOnly refresh cookie.
 * Clears stale persisted user if refresh fails.
 */
export async function bootstrapSessionFromCookie(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  } catch {
    /* ignore */
  }

  if (useAuthStore.getState().accessToken) return;

  /** Persisted profile without access JWT — typical after tab sleep / restart; refresh cookie may still be valid. */
  const hadPersistedUser = !!useAuthStore.getState().user;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${AUTH_REFRESH_PATH}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    /** API unreachable (server down, CORS, network offline) — silently clear session; login page will handle reconnection. */
    useAuthStore.getState().clearSession();
    if (hadPersistedUser && !isPublicAuthRoute()) {
      clearClientSessionAndGoLogin("network=1");
    }
    return;
  }

  if (!res.ok) {
    useAuthStore.getState().clearSession();
    if (hadPersistedUser && !isPublicAuthRoute()) {
      clearClientSessionAndGoLogin("session=expired");
    }
    return;
  }

  try {
    const data = (await res.json()) as AuthSuccessResponse;
    useAuthStore.getState().setAuth(mapUser(data.user), data.accessToken);
  } catch {
    useAuthStore.getState().clearSession();
  }
}

/** Proactively refresh before heavy batches (shares mutex with apiClient). */
export async function ensureValidToken(): Promise<void> {
  if (typeof window === "undefined") return;
  const token = useAuthStore.getState().accessToken;
  if (token) return;
  await tryRefreshToken();
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let token = typeof window !== "undefined" ? useAuthStore.getState().accessToken : null;

  const doFetch = (accessToken: string | null) => {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    if (accessToken) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${accessToken}`;
    }
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  };

  let res = await doFetch(token);

  if (
    res.status === 401 &&
    path !== AUTH_REFRESH_PATH &&
    !path.startsWith("/auth/request-otp")
  ) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      res = await doFetch(newToken);
    }
  }

  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({
      statusCode: res.status,
      message: res.statusText,
    }));
    const msg = Array.isArray(err.message) ? err.message.join(", ") : String(err.message ?? "");
    throw new ApiRequestError(msg, res.status, err.clientCode || err.code);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<T> {
  let token = typeof window !== "undefined" ? useAuthStore.getState().accessToken : null;

  const doFetch = (accessToken: string | null) => {
    const headers: HeadersInit = {
      ...(options.headers as Record<string, string>),
    };
    if (accessToken) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${accessToken}`;
    }
    return fetch(`${API_BASE}${path}`, {
      ...options,
      method: options.method || "POST",
      body: formData,
      headers,
      credentials: "include",
    });
  };

  let res = await doFetch(token);

  if (res.status === 401 && path !== AUTH_REFRESH_PATH) {
    const newToken = await tryRefreshToken();
    if (newToken) res = await doFetch(newToken);
  }

  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({
      statusCode: res.status,
      message: res.statusText,
    }));
    const msg = Array.isArray(err.message) ? err.message.join(", ") : String(err.message ?? "");
    throw new ApiRequestError(msg, res.status, err.clientCode || err.code);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}
