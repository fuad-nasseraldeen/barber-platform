import type { UserRole } from "@/stores/auth-store";

/**
 * Admin pages and the minimum role required to access them.
 * Matches backend API restrictions.
 */
export const ADMIN_PAGE_ROLES: Record<string, UserRole[]> = {
  "/admin/dashboard": ["owner", "manager", "staff"],
  "/admin/appointments": ["owner", "manager", "staff"],
  "/admin/waitlist": ["owner", "manager", "staff"],
  "/admin/customers": ["owner", "manager", "staff"],
  "/admin/arrival-confirmations": ["owner", "manager", "staff"],
  "/admin/staff": ["owner", "manager"],
  "/admin/breaks": ["owner", "manager"],
  "/admin/vacations": ["owner", "manager"],
  "/admin/services": ["owner", "manager", "staff"],
  "/admin/analytics": ["owner", "manager"],
  "/admin/automations": ["owner", "manager"],
  "/admin/notifications": ["owner", "manager", "staff"],
  "/admin/settings": ["owner", "manager"],
  "/admin/branches": ["owner", "manager", "staff"],
};

/** Roles that can access the admin area at all (customer cannot) */
export const ADMIN_ACCESS_ROLES: UserRole[] = ["owner", "manager", "staff"];

export function canAccessAdmin(role?: UserRole): boolean {
  return !!role && ADMIN_ACCESS_ROLES.includes(role);
}

export function canAccessPage(pathname: string, role?: UserRole): boolean {
  if (!role) return false;
  if (!canAccessAdmin(role)) return false;

  const path = pathname.replace(/\/$/, "") || "/admin";
  let allowedRoles = ADMIN_PAGE_ROLES[path];
  if (!allowedRoles && path.startsWith("/admin/")) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const basePath = "/admin/" + parts[1];
      allowedRoles = ADMIN_PAGE_ROLES[basePath];
    }
  }
  return !!allowedRoles?.includes(role);
}

export function getAllowedPages(role?: UserRole): string[] {
  if (!role || !canAccessAdmin(role)) return [];
  return Object.entries(ADMIN_PAGE_ROLES)
    .filter(([, roles]) => roles.includes(role))
    .map(([path]) => path);
}
