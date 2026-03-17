"use client";

import { useState, useRef, useEffect } from "react";
import { DropdownArrow } from "@/components/ui/nav-arrow";
import { useLocaleStore, type Locale } from "@/stores/locale-store";
import { useTranslation } from "@/hooks/use-translation";

const locales: { value: Locale; labelKey: string }[] = [
  { value: "en", labelKey: "settings.localeEn" },
  { value: "ar", labelKey: "settings.localeAr" },
  { value: "he", labelKey: "settings.localeHe" },
];

export function LocaleSwitcher() {
  const t = useTranslation();
  const { locale, setLocale } = useLocaleStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentLabel = locales.find((l) => l.value === locale)
    ? t(locales.find((l) => l.value === locale)!.labelKey)
    : locale;

  return (
    <div className="relative w-fit" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-all duration-300 hover:scale-105 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        aria-label="Language"
        aria-expanded={open}
      >
        <DropdownArrow className="h-4 w-4 shrink-0 text-zinc-500" />
        <span>{currentLabel}</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute end-0 top-full z-50 mt-2 min-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white py-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            {locales.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => {
                  setLocale(l.value);
                  setOpen(false);
                }}
                className={`w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  locale === l.value
                    ? "sidebar-active font-medium"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {t(l.labelKey)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
