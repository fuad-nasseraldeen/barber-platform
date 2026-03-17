/**
 * Google Maps Places loader using @googlemaps/js-api-loader.
 * Uses importLibrary for reliable loading (recommended over legacy script tag).
 */

import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let optionsSet = false;
let loadPromise: Promise<google.maps.PlacesLibrary> | null = null;

export async function loadGoogleMapsPlaces(): Promise<google.maps.PlacesLibrary> {
  if (typeof window === "undefined") {
    throw new Error("Cannot load Google Maps on server");
  }

  if (loadPromise) return loadPromise;

  if (!optionsSet) {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key) throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set");
    setOptions({ key, v: "weekly" });
    optionsSet = true;
  }

  loadPromise = importLibrary("places") as Promise<google.maps.PlacesLibrary>;
  return loadPromise;
}
