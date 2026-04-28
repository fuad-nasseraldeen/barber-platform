"use client";

import { useEffect } from "react";

function isChunkLoadError(error: Error): boolean {
  if (error.name === "ChunkLoadError") return true;
  const msg = error.message ?? "";
  return /Loading chunk .* failed/i.test(msg) || /missing:.*\/_next\/static\/chunks\//i.test(msg);
}

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);

    if (typeof window === "undefined" || !isChunkLoadError(error)) return;

    // After HMR / rebuild, the browser may still request an old chunk URL once.
    const key = `admin_chunk_reload:${window.location.pathname}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      window.location.reload();
    } catch {
      /* private mode etc. */
    }
  }, [error]);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center p-8">
      <h2 className="mb-2 text-xl font-semibold">Something went wrong</h2>
      <p className="mb-6 max-w-md text-center text-zinc-600 dark:text-zinc-400">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Try again
      </button>
    </div>
  );
}
