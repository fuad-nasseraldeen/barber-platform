declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: { types?: string[]; fields?: string[] }
          ) => {
            addListener: (event: string, cb: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              geometry?: { location: { lat: () => number; lng: () => number } };
              address_components?: Array<{
                long_name: string;
                types: string[];
              }>;
            };
          };
        };
      };
    };
    initPlacesAutocomplete?: () => void;
  }
}


export {};
