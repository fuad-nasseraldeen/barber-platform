"use client";

import { useEffect, useState, useRef } from "react";
import { Sun, Moon } from "lucide-react";
import { DropdownArrow } from "@/components/ui/nav-arrow";
import { useThemeStore, type ThemeName } from "@/stores/theme-store";
import { useTranslation } from "@/hooks/use-translation";

const themes: { value: ThemeName; labelKey: string }[] = [
  { value: "dark", labelKey: "settings.themeDark" },
  { value: "gold", labelKey: "settings.themeGold" },
  { value: "rose", labelKey: "settings.themeRose" },
  { value: "coffee", labelKey: "settings.themeCoffee" },
  { value: "ocean", labelKey: "settings.themeOcean" },
];

export function ThemeToggle() {
  const t = useTranslation();
  const { theme, colorScheme, setTheme, setColorScheme } = useThemeStore();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.toggle("dark", colorScheme === "dark");
  }, [theme, colorScheme, mounted]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!mounted) return null;

  const currentThemeLabel = themes.find((th) => th.value === theme)
    ? t(themes.find((th) => th.value === theme)!.labelKey)
    : theme;

  return (
    <div className="flex w-fit items-center gap-2">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-all duration-300 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          aria-label="Theme"
          aria-expanded={open}
        >
          <DropdownArrow className="h-4 w-4 shrink-0 text-zinc-500" />
          <span>{currentThemeLabel}</span>
        </button>
        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute end-0 top-full z-50 mt-2 min-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white py-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              {themes.map((th) => (
                <button
                  key={th.value}
                  type="button"
                  onClick={() => {
                    setTheme(th.value);
                    setOpen(false);
                  }}
                  className={`w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    theme === th.value
                      ? "sidebar-active font-medium"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {t(th.labelKey)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}
        className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-all duration-300 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      >
        {colorScheme === "dark" ? (
          <Moon className="h-4 w-4 text-zinc-500" />
        ) : (
          <Sun className="h-4 w-4 text-zinc-500" />
        )}
      </button>
    </div>
  );
}
