"use client";

import { Loader2 } from "lucide-react";

interface LoadingButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}

export function LoadingButton({
  loading = false,
  disabled,
  children,
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: LoadingButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed";
  const variants = {
    primary: "btn-primary",
    secondary:
      "border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700",
    ghost: "hover:bg-zinc-100 dark:hover:bg-zinc-800",
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <Loader2 className="loading-button-spinner h-4 w-4 animate-spin" />
      ) : null}
      {children}
    </button>
  );
}
