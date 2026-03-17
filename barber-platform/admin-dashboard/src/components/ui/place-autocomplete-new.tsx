"use client";

import { useEffect, useRef, useState } from "react";

export type PlaceData = {
  address: string;
  city: string;
  street?: string;
  lat: number;
  lng: number;
};

interface PlaceAutocompleteNewProps {
  value: string;
  onChange: (value: string, place?: PlaceData) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

const SCRIPT_ID = "google-maps-places-loader";

function waitForGoogle(): Promise<typeof google> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Not in browser"));
      return;
    }
    if (window.google?.maps?.places) {
      resolve(window.google);
      return;
    }
    const check = () => {
      if (window.google?.maps?.places) {
        resolve(window.google);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
    setTimeout(() => reject(new Error("Google Maps load timeout")), 15000);
  });
}

export function PlaceAutocompleteNew({
  value,
  onChange,
  placeholder = "Search for an address",
  id = "place-autocomplete",
  className = "",
  disabled = false,
}: PlaceAutocompleteNewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apiKey = typeof window !== "undefined" ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY : undefined;

  useEffect(() => {
    if (!apiKey) {
      setLoadError("NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set");
      return;
    }

    const script = document.getElementById(SCRIPT_ID);
    if (script?.getAttribute("data-loaded") === "true") {
      setScriptLoaded(true);
      return;
    }

    const existing = document.querySelector(`script[src*="maps.googleapis.com"][src*="key=${apiKey}"]`);
    if (existing) {
      waitForGoogle()
        .then(() => setScriptLoaded(true))
        .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
      return;
    }

    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      s.setAttribute("data-loaded", "true");
      setScriptLoaded(true);
    };
    s.onerror = () => setLoadError("Failed to load Google Maps script");
    document.head.appendChild(s);
  }, [apiKey]);

  useEffect(() => {
    if (!scriptLoaded || !inputRef.current || !window.google?.maps?.places) return;

    const input = inputRef.current;
    if (autocompleteRef.current) return;

    const autocomplete = new google.maps.places.Autocomplete(input, {
      types: ["address"],
      componentRestrictions: { country: "il" },
      fields: ["formatted_address", "geometry", "address_components"],
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place?.geometry?.location) return;

      const formatted = place.formatted_address ?? "";
      const loc = place.geometry.location;
      const lat = typeof loc.lat === "function" ? loc.lat() : (loc as { lat: number }).lat;
      const lng = typeof loc.lng === "function" ? loc.lng() : (loc as { lng: number }).lng;

      let city = "";
      let street = "";
      const components = place.address_components ?? [];
      const getLong = (c: google.maps.GeocoderAddressComponent) => c?.long_name ?? "";
      const locality = components.find((c) => c.types?.includes("locality"));
      const admin = components.find((c) => c.types?.includes("administrative_area_level_1"));
      const route = components.find((c) => c.types?.includes("route"));
      const streetNum = components.find((c) => c.types?.includes("street_number"));
      city = getLong(locality!) || getLong(admin!);
      street = [getLong(streetNum!), getLong(route!)].filter(Boolean).join(" ") || formatted;

      onChange(formatted, { address: formatted, city, street, lat, lng });
    });

    autocompleteRef.current = autocomplete;

    return () => {
      google.maps.event.clearInstanceListeners(autocomplete);
      autocompleteRef.current = null;
    };
  }, [scriptLoaded, onChange]);

  if (loadError) {
    return (
      <div className={className}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          disabled={disabled}
        />
        <p className="mt-1 text-sm text-amber-600">{loadError}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        id={id}
        disabled={disabled || !scriptLoaded}
        className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
    </div>
  );
}
