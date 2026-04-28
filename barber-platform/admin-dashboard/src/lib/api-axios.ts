/**
 * Optional Axios client with the same semantics as `api-client.ts` (fetch).
 * Use when you prefer interceptors on an Axios instance; the app default remains `apiClient`.
 */
import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { useAuthStore } from "@/stores/auth-store";
import { getApiBase } from "@/lib/api-client";

const AUTH_REFRESH_PATH = "/auth/refresh";

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await axios.post<{
        accessToken: string;
        user: {
          id: string;
          phone?: string;
          email?: string;
          name?: string;
          businessId?: string;
          role?: string;
          staffId?: string;
        };
      }>(
        `${getApiBase()}${AUTH_REFRESH_PATH}`,
        {},
        { withCredentials: true, headers: { "Content-Type": "application/json" } }
      );
      const { accessToken, user } = res.data;
      useAuthStore.getState().setAuth(
        {
          id: user.id,
          phone: user.phone,
          email: user.email,
          name: user.name,
          businessId: user.businessId,
          role: (user.role as "owner" | "manager" | "staff" | "customer") ?? "customer",
          staffId: user.staffId,
        },
        accessToken
      );
      return accessToken;
    } catch {
      useAuthStore.getState().clearSession();
      if (typeof window !== "undefined") {
        void useAuthStore.getState().logout();
        window.location.href = "/login";
      }
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** Single Axios instance: credentials + 401 queue + one retry (no infinite loop). */
export function createApiAxios(): AxiosInstance {
  const instance = axios.create({
    baseURL: getApiBase(),
    withCredentials: true,
    headers: { "Content-Type": "application/json" },
  });

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (r) => r,
    async (error: AxiosError) => {
      const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
      const status = error.response?.status;
      const url = original?.url ?? "";

      if (
        status !== 401 ||
        original?._retry ||
        url.includes(AUTH_REFRESH_PATH) ||
        url.includes("/auth/request-otp")
      ) {
        return Promise.reject(error);
      }

      original._retry = true;
      const newToken = await refreshAccessToken();
      if (!newToken) return Promise.reject(error);

      original.headers.Authorization = `Bearer ${newToken}`;
      return instance(original);
    }
  );

  return instance;
}
