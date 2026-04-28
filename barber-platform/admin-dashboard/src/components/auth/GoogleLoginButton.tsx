"use client";

import { useEffect, useId, useRef, useState } from "react";
import { loadGoogleGsi } from "@/lib/gsi-loader";

// Singleton: GSI initialize() must be called only once per page.
// We store the latest callback so returning to login page still works.
let gsiInitialized = false;
let initNonce = "";
let currentOnSuccess: (r: GoogleLoginResult) => void = () => {};
let currentOnError: (e: Error) => void = () => {};

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
  const renderedRef = useRef(false);

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
    const id = g?.accounts?.id;
    if (!id?.initialize || !id?.renderButton) return;

    // Keep callback refs current (for when user returns to login)
    currentOnSuccess = (r) => onSuccessRef.current(r);
    currentOnError = (e) => onErrorRef.current?.(e);

    // Initialize GSI once per app session
    if (!gsiInitialized) {
      gsiInitialized = true;
      initNonce = crypto.randomUUID();
      nonceRef.current = initNonce;
      id.initialize({
        client_id: clientId,
        nonce: initNonce,
        callback: (res: { credential?: string }) => {
          if (!res.credential) {
            currentOnError(new Error("Missing credential"));
            return;
          }
          currentOnSuccess({ credential: res.credential, nonce: initNonce });
        },
      });
    }

    const el = document.getElementById(buttonId);
    if (el && !renderedRef.current) {
      renderedRef.current = true;
      el.innerHTML = "";
      id.renderButton(el, {
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
