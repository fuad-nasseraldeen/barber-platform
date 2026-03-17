"use client";

import { useEffect, useState } from "react";
import { useThemeStore, type ThemeName } from "@/stores/theme-store";
import { useTranslation } from "@/hooks/use-translation";
import { Sun, Moon, Palette } from "lucide-react";

const themes: { value: ThemeName; labelKey: string }[] = [
  { value: "dark", labelKey: "settings.themeDark" },
  { value: "gold", labelKey: "settings.themeGold" },
  { value: "rose", labelKey: "settings.themeRose" },
  { value: "coffee", labelKey: "settings.themeCoffee" },
  { value: "ocean", labelKey: "settings.themeOcean" },
];

export function ThemeSwitcher() {
  const t = useTranslation();
  const { theme, colorScheme, setTheme, setColorScheme } = useThemeStore();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.toggle("dark", colorScheme === "dark");
  }, [theme, colorScheme, mounted]);

  if (!mounted) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-all duration-300 hover:scale-105 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        aria-label="Theme settings"
      >
        <Palette className="h-4 w-4 text-zinc-500" />
        <span className="hidden sm:inline">{themes.find((th) => th.value === theme) ? t(themes.find((th) => th.value === theme)!.labelKey) : theme}</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute start-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl sm:start-auto sm:end-0 sm:max-w-none dark:border-zinc-700 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <p className="text-start text-xs font-medium uppercase tracking-wider text-zinc-500">
                {t("settings.theme")}
              </p>
            </div>
            <div className="p-2">
              {themes.map((th) => (
                <button
                  key={th.value}
                  type="button"
                  onClick={() => setTheme(th.value)}
                  className={`w-full rounded-lg px-3 py-2 text-start text-sm transition-all duration-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    theme === th.value
                      ? "sidebar-active font-medium"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {t(th.labelKey)}
                </button>
              ))}
            </div>
            <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <p className="mb-2 text-start text-xs font-medium uppercase tracking-wider text-zinc-500">
                {t("settings.mode")}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setColorScheme("light")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-300 ${
                    colorScheme === "light"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  <Sun className="h-4 w-4 shrink-0" />
                  {t("settings.modeLight")}
                </button>
                <button
                  type="button"
                  onClick={() => setColorScheme("dark")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-300 ${
                    colorScheme === "dark"
                      ? "sidebar-active"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  <Moon className="h-4 w-4 shrink-0" />
                  {t("settings.modeDark")}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
