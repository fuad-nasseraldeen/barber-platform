declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          disableAutoSelect?: () => void;
          initialize?: (opts: {
            client_id: string;
            nonce: string;
            callback?: (res: { credential?: string }) => void;
          }) => void;
          renderButton?: (
            el: HTMLElement,
            opts?: { type?: string; theme?: string; size?: string; width?: number }
          ) => void;
        };
      };
      maps?: {
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
