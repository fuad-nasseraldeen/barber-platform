import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "dark" | "gold" | "rose" | "coffee" | "ocean";
export type ColorScheme = "light" | "dark";

interface ThemeState {
  theme: ThemeName;
  colorScheme: ColorScheme;
  setTheme: (theme: ThemeName) => void;
  setColorScheme: (scheme: ColorScheme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "ocean" as ThemeName,
      colorScheme: "dark" as ColorScheme,
      setTheme: (theme) => {
        set({ theme });
        if (typeof document !== "undefined") {
          document.documentElement.setAttribute("data-theme", theme);
        }
      },
      setColorScheme: (colorScheme) => {
        set({ colorScheme });
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", colorScheme === "dark");
        }
      },
    }),
    { name: "theme-storage" }
  )
);
