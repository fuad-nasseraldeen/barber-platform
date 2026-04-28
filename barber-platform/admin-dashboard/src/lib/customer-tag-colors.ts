/**
 * Canonical palette for customer tag colors (DB + calendar border accents).
 * Saturated hues: hash(customerId) picks a slot — same client always gets the same color.
 * Keep in sync with customer picker UI.
 */
export const CUSTOMER_TAG_COLORS_HEX = [
  "#2563EB",
  "#DC2626",
  "#059669",
  "#CA8A04",
  "#9333EA",
  "#DB2777",
  "#EA580C",
  "#0891B2",
  "#4F46E5",
  "#0D9488",
  "#65A30D",
  "#C026D3",
  "#E11D48",
  "#1D4ED8",
  "#B45309",
  "#7C3AED",
  "#0F766E",
  "#A16207",
] as const;

export function hashStringToIndex(str: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
  }
  return Math.abs(h) % modulo;
}

export function hexColorForCustomerId(customerId: string): string {
  return CUSTOMER_TAG_COLORS_HEX[
    hashStringToIndex(customerId, CUSTOMER_TAG_COLORS_HEX.length)
  ];
}

const HEX_6 = /^#[0-9A-Fa-f]{6}$/;

/** Saved tag from API if valid hex; otherwise deterministic color from customer id. */
export function resolveCustomerEventColor(
  customerId: string | undefined,
  tagColor?: string | null,
): string {
  const raw = tagColor?.trim();
  if (raw && HEX_6.test(raw)) {
    return raw;
  }
  if (!customerId) return CUSTOMER_TAG_COLORS_HEX[0];
  return hexColorForCustomerId(customerId);
}

/**
 * Tailwind row/card accents — same order as {@link CUSTOMER_TAG_COLORS_HEX} for list UIs.
 */
export const CUSTOMER_TAG_ROW_CLASSES: readonly string[] = [
  "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100",
  "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  "bg-pink-100 text-pink-900 dark:bg-pink-900/40 dark:text-pink-100",
  "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/40 dark:text-cyan-100",
  "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100",
  "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100",
  "bg-lime-100 text-lime-900 dark:bg-lime-900/40 dark:text-lime-100",
  "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
  "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  "bg-blue-100 text-blue-950 dark:bg-blue-950/50 dark:text-blue-100",
  "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  "bg-violet-100 text-violet-950 dark:bg-violet-950/45 dark:text-violet-100",
  "bg-teal-100 text-teal-950 dark:bg-teal-950/45 dark:text-teal-100",
  "bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
];

export function customerIdToRowClass(customerId: string | undefined): string {
  if (!customerId) return CUSTOMER_TAG_ROW_CLASSES[0];
  const idx = hashStringToIndex(customerId, CUSTOMER_TAG_ROW_CLASSES.length);
  return CUSTOMER_TAG_ROW_CLASSES[idx] ?? CUSTOMER_TAG_ROW_CLASSES[0];
}
