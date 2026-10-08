export function isRevision(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
    && !value.startsWith("-") && !/[\x00-\x20\x7f]/.test(value);
}

export function isLiteralPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/")
    && !value.includes("\0") && !value.split("/").some(part => !part || part === "." || part === "..");
}
