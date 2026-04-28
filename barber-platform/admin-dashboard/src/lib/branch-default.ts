/** Prefer DB branch named "Main Branch", else first branch in list. */
export function resolveDefaultBranchId(
  branches: readonly { id: string; name: string }[],
): string | null {
  if (branches.length === 0) return null;
  const main = branches.find((b) => /^main\s*branch$/i.test(b.name.trim()));
  return main?.id ?? branches[0]!.id;
}
