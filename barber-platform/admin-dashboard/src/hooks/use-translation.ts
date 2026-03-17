"use client";

import { useLocaleStore } from "@/stores/locale-store";
import { t } from "@/lib/i18n";

export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);
  return (key: string) => t(locale, key);
}
