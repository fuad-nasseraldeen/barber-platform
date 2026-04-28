"use client";

import { useEffect, useState } from "react";
import { bootstrapSessionFromCookie } from "@/lib/api-client";

/**
 * Best-effort: restore access JWT from HttpOnly refresh cookie after load.
 * Never blocks the app indefinitely: timeout + no dependency on persist hydration callback.
 */
export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const SAFETY_MS = 5000;
    const safety = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, SAFETY_MS);

    void bootstrapSessionFromCookie()
      .catch(() => {
        /* bootstrapSessionFromCookie is defensive; never block shell */
      })
      .finally(() => {
        window.clearTimeout(safety);
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(safety);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
