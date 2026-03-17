import { useAuthStore } from "@/stores/auth-store";

const prefix = process.env.NEXT_PUBLIC_API_PREFIX || "api/v1";
const base = process.env.NEXT_PUBLIC_API_URL;

/** API paths (prefixed with /api/v1 by API_BASE). Use these for apiClient calls. */
export const API_PATHS = {
  AUTH_GOOGLE: "/auth/google",
} as const;
// Use relative URL (Next.js proxy) when API_URL is empty; avoids CORS
const API_BASE =
  typeof window !== "undefined" && (!base || base === "")
    ? `/${prefix}`
    : (base || "http://localhost:3000") + "/" + prefix;

export function getApiBase(): string {
  return API_BASE;
}

/** Base URL for non-API paths (e.g. uploads) - same origin when using proxy */
export function getUploadsBase(): string {
  if (typeof window === "undefined") return "";
  const b = process.env.NEXT_PUBLIC_API_URL;
  if (!b || b === "") return ""; // same origin
  return (b || "http://localhost:3000");
}

export type ApiError = {
  statusCode: number;
  message: string | string[];
  error?: string;
};

function clearAuthAndRedirect() {
  if (typeof window === "undefined") return;
  useAuthStore.getState().logout();
  window.location.href = "/login";
}

/** Proactively refresh token before batch operations to avoid 401 on first request */
export async function ensureValidToken(): Promise<void> {
  if (typeof window === "undefined") return;
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return;
  await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  }).then(async (res) => {
    if (!res.ok) return;
    const data = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; phone?: string; email?: string; name?: string; businessId?: string; role?: string; staffId?: string };
    };
    localStorage.setItem("access_token", data.accessToken);
    if (data.refreshToken) localStorage.setItem("refresh_token", data.refreshToken);
    useAuthStore.getState().setAuth(
      {
        id: data.user.id,
        phone: data.user.phone,
        email: data.user.email,
        name: data.user.name,
        businessId: data.user.businessId,
        role: (data.user.role as "owner" | "manager" | "staff" | "customer") ?? "customer",
        staffId: data.user.staffId,
      },
      data.accessToken,
      data.refreshToken
    );
  });
}

async function tryRefreshToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    clearAuthAndRedirect();
    return null;
  }
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    clearAuthAndRedirect();
    return null;
  }
  const data = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; phone?: string; email?: string; name?: string; businessId?: string; role?: string; staffId?: string };
  };
  localStorage.setItem("access_token", data.accessToken);
  if (data.refreshToken) localStorage.setItem("refresh_token", data.refreshToken);
  useAuthStore.getState().setAuth(
    {
      id: data.user.id,
      phone: data.user.phone,
      email: data.user.email,
      name: data.user.name,
      businessId: data.user.businessId,
      role: (data.user.role as "owner" | "manager" | "staff" | "customer") ?? "customer",
      staffId: data.user.staffId,
    },
    data.accessToken,
    data.refreshToken
  );
  return data.accessToken;
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let token =
    typeof window !== "undefined"
      ? localStorage.getItem("access_token")
      : undefined;

  const doFetch = (accessToken: string | undefined) => {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    if (accessToken) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${accessToken}`;
    }
    return fetch(`${API_BASE}${path}`, { ...options, headers });
  };

  let res = await doFetch(token ?? undefined);

  if (res.status === 401 && token && path !== "/auth/refresh") {
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
    throw new Error(
      Array.isArray(err.message) ? err.message.join(", ") : err.message
    );
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Upload file (FormData) - no Content-Type so browser sets multipart boundary */
export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<T> {
  let token =
    typeof window !== "undefined"
      ? localStorage.getItem("access_token")
      : undefined;

  const doFetch = (accessToken: string | undefined) => {
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
    });
  };

  let res = await doFetch(token ?? undefined);

  if (res.status === 401 && token && path !== "/auth/refresh") {
    const newToken = await tryRefreshToken();
    if (newToken) res = await doFetch(newToken);
  }

  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({
      statusCode: res.status,
      message: res.statusText,
    }));
    throw new Error(
      Array.isArray(err.message) ? err.message.join(", ") : err.message
    );
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}
