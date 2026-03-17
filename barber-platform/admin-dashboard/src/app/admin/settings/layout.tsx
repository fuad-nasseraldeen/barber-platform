"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BackArrow } from "@/components/ui/nav-arrow";
import { useTranslation } from "@/hooks/use-translation";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslation();
  const isSubPage = pathname !== "/admin/settings";

  if (!isSubPage) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/settings"
        className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-[var(--primary)] dark:text-zinc-400"
      >
        <BackArrow className="h-4 w-4" />
        {t("nav.settings")}
      </Link>
      {children}
    </div>
  );
}
