"use client";

import { useEffect } from "react";
import { useLocaleStore } from "@/stores/locale-store";

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { locale, dir } = useLocaleStore();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  return <>{children}</>;
}
