import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Locale = "en" | "ar" | "he";

interface LocaleState {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
}

const localeToDir: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
  he: "rtl",
};

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: "en",
      dir: "ltr",
      setLocale: (locale) =>
        set({ locale, dir: localeToDir[locale] }),
    }),
    { name: "locale-storage" }
  )
);
