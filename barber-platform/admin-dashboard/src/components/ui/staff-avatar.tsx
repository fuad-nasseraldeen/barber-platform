"use client";

/** Resolve avatar URL - add API base for relative paths */
export function getAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http")) return avatarUrl;
  const base = process.env.NEXT_PUBLIC_API_URL || "";
  return base ? `${base}${avatarUrl}` : avatarUrl;
}

interface StaffAvatarProps {
  avatarUrl?: string | null;
  firstName?: string;
  lastName?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Icon to show when no avatar and no initials (e.g. User icon) */
  fallbackIcon?: React.ReactNode;
}

const sizeClasses = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-14 w-14 text-xl",
};

export function StaffAvatar({
  avatarUrl,
  firstName = "",
  lastName = "",
  size = "md",
  className = "",
  fallbackIcon,
}: StaffAvatarProps) {
  const resolved = getAvatarUrl(avatarUrl);
  const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase().trim() || "?";
  const sizeCls = sizeClasses[size];

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700 ${sizeCls} ${className}`}
    >
      {resolved ? (
        <img
          src={resolved}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : fallbackIcon && initials === "?" ? (
        <div className="flex h-full w-full items-center justify-center text-zinc-500 dark:text-zinc-400">
          {fallbackIcon}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center font-medium text-zinc-500 dark:text-zinc-400">
          {initials}
        </div>
      )}
    </div>
  );
}
