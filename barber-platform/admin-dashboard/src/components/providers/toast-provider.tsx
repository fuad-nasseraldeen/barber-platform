"use client";

import { Toaster } from "react-hot-toast";

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: "rgb(39 39 42)",
          color: "rgb(250 250 250)",
          borderRadius: "12px",
        },
        success: { iconTheme: { primary: "#22c55e", secondary: "#166534" } },
        error: { iconTheme: { primary: "#ef4444", secondary: "#991b1b" } },
      }}
    />
  );
}
