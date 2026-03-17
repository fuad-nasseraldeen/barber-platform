"use client";

import { useEffect, useId, useRef, useState } from "react";
import { loadGoogleGsi } from "@/lib/gsi-loader";

declare global {
  interface Window {
    google?: any;
  }
}

export interface GoogleLoginResult {
  credential: string;
  nonce: string;
}

interface GoogleLoginButtonProps {
  onSuccess: (result: GoogleLoginResult) => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
  buttonId?: string;
}

export function GoogleLoginButton({
  onSuccess,
  onError,
  disabled = false,
  buttonId: buttonIdProp,
}: GoogleLoginButtonProps) {
  const generatedId = useId();
  const buttonId = buttonIdProp ?? `google-login-btn-${generatedId.replace(/:/g, "")}`;
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const nonceRef = useRef<string>("");
  const initializedRef = useRef(false);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    if (!clientId || typeof window === "undefined") return;
    loadGoogleGsi()
      .then(() => setScriptLoaded(true))
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load Google");
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      });
  }, [clientId]);

  useEffect(() => {
    if (!scriptLoaded || !clientId || typeof window === "undefined") return;
    const g = window.google;
    if (!g?.accounts?.id) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      const nonce = crypto.randomUUID();
      nonceRef.current = nonce;
      g.accounts.id.initialize({
        client_id: clientId,
        nonce,
        callback: (res: { credential?: string }) => {
          if (!res.credential) {
            onErrorRef.current?.(new Error("Missing credential"));
            return;
          }
          onSuccessRef.current({ credential: res.credential, nonce: nonceRef.current });
        },
      });
    }

    const el = document.getElementById(buttonId);
    if (el) {
      el.innerHTML = "";
      g.accounts.id.renderButton(el, {
          type: "standard",
          theme: "outline",
          size: "large",
          width: 280,
        });
    }
  }, [scriptLoaded, clientId, buttonId]);

  if (!clientId) {
    return (
      <p className="text-center text-sm text-zinc-500">Google login not configured</p>
    );
  }

  if (loadError) {
    return (
      <p className="text-center text-sm text-red-500">{loadError}</p>
    );
  }

  return (
    <div className={`flex justify-center ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <div id={buttonId} />
    </div>
  );
}
