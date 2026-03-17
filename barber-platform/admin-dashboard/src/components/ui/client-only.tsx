"use client";

import { useState, useEffect } from "react";

/**
 * Renders children only after mount to avoid hydration mismatch
 * when content differs between server (e.g. default locale) and client (e.g. localStorage locale).
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
}
