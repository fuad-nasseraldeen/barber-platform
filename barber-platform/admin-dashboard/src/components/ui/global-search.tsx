"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const t = useTranslation();

  return (
    <div className="relative w-full max-w-md">
      <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        type="search"
        placeholder={t("topbar.searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-10 pr-4 text-sm placeholder-zinc-500 focus:border-zinc-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/50 dark:placeholder-zinc-400 dark:focus:border-zinc-600 dark:focus:bg-zinc-800"
      />
    </div>
  );
}
