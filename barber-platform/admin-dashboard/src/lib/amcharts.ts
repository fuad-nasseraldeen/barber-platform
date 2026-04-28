"use client";

import * as am5 from "@amcharts/amcharts5";

let licenseRegistered = false;
const rootByElement = new WeakMap<HTMLElement, am5.Root>();

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function hslToHex(h: number, s: number, l: number): string {
  const normalizedS = Math.max(0, Math.min(100, s)) / 100;
  const normalizedL = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * normalizedL - 1)) * normalizedS;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = normalizedL - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hslTokenToHex(token: string, fallback: string): string {
  const trimmed = token.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith("#") || trimmed.startsWith("rgb")) return trimmed;

  const parts = trimmed
    .replace(/^hsl\(/, "")
    .replace(/\)$/, "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((part) => part.replace("%", ""));

  if (parts.length < 3) return fallback;

  const h = Number(parts[0]);
  const s = Number(parts[1]);
  const l = Number(parts[2]);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return fallback;

  return hslToHex(h, s, l);
}

export function ensureAmchartsLicense(): void {
  if (licenseRegistered || typeof window === "undefined") return;
  const licenseKey = process.env.NEXT_PUBLIC_AMCHARTS_LICENSE_KEY;
  if (licenseKey) {
    am5.addLicense(licenseKey);
  }
  licenseRegistered = true;
}

export function createAmchartsRoot(element: HTMLElement): am5.Root {
  ensureAmchartsLicense();
  const prevRoot = rootByElement.get(element);
  if (prevRoot) {
    prevRoot.dispose();
    rootByElement.delete(element);
  }

  const root = am5.Root.new(element);
  rootByElement.set(element, root);
  return root;
}

export function disposeAmchartsRoot(element: HTMLElement | null | undefined): void {
  if (!element) return;
  const root = rootByElement.get(element);
  if (!root) return;
  root.dispose();
  rootByElement.delete(element);
}

export type AmchartsPalette = {
  primary: string;
  secondary: string;
  tertiary: string;
  text: string;
  mutedText: string;
  grid: string;
  surface: string;
};

export function resolveAmchartsPalette(overrides?: Partial<AmchartsPalette>): AmchartsPalette {
  const chart2 = hslTokenToHex(readCssVar("--chart-2", "160 84% 39%"), "#10b981");
  const chart3 = hslTokenToHex(readCssVar("--chart-3", "38 92% 50%"), "#f59e0b");
  const palette: AmchartsPalette = {
    primary: readCssVar("--primary", "#3b82f6"),
    secondary: chart2,
    tertiary: chart3,
    text: readCssVar("--foreground", "#111827"),
    mutedText: readCssVar("--muted-foreground", "#6b7280"),
    grid: readCssVar("--muted", "#d4d4d8"),
    surface: readCssVar("--background", "#ffffff"),
  };

  return {
    ...palette,
    ...overrides,
  };
}
