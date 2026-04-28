/** Calendar Y-M-D in the browser's local timezone (not UTC). */
export function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysLocal(ymd: string, deltaDays: number): string {
  const [y, mo, day] = ymd.split("-").map(Number);
  const d = new Date(y, mo - 1, day);
  d.setDate(d.getDate() + deltaDays);
  return formatYmdLocal(d);
}
