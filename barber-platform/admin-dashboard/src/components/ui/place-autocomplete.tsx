"use client";

export type PlaceData = {
  address: string;
  city: string;
  street?: string;
  lat: number;
  lng: number;
};

export { PlaceAutocompleteNew as PlaceAutocomplete } from "./place-autocomplete-new";
