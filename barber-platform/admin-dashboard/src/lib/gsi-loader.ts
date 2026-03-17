const SCRIPT_ID = "google-gsi-client-script";
let loadPromise: Promise<void> | null = null;

export function loadGoogleGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  if (typeof (window as Window & { google?: any }).google?.accounts?.id !== "undefined") {
    return Promise.resolve();
  }

  if (loadPromise) return loadPromise;

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing?.src) {
    loadPromise = new Promise((resolve, reject) => {
      if (typeof (window as Window & { google?: any }).google?.accounts?.id !== "undefined") {
        resolve();
        return;
      }
      existing.onload = () => resolve();
      existing.onerror = () => reject(new Error("Failed to load Google GSI"));
    });
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google GSI"));
    document.head.appendChild(script);
  });

  return loadPromise;
}
