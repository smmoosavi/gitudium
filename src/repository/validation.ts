export function isRevision(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
    && !value.startsWith("-") && !/[\x00-\x20\x7f]/.test(value);
}

export function isHistoryExpression(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return false;
  if (!value.trim()) return true;
  return value.split(",").every(part => {
    const term = part.trim();
    const revision = term.startsWith("!") ? term.slice(1) : term;
    return isRevision(revision) && !revision.startsWith("!");
  });
}

export function isLiteralPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/")
    && !value.includes("\0") && !value.split("/").some(part => !part || part === "." || part === "..");
}
