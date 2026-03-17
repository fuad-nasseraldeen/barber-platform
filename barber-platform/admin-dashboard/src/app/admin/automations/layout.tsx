"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BackArrow } from "@/components/ui/nav-arrow";
import { useTranslation } from "@/hooks/use-translation";

export default function AutomationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslation();
  const isSubPage = pathname !== "/admin/automations";

  if (!isSubPage) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/automations"
        className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-[var(--primary)] dark:text-zinc-400"
      >
        <BackArrow className="h-4 w-4" />
        {t("nav.automations")}
      </Link>
      {children}
    </div>
  );
}
