import type { Reference } from "../repository/types";

export interface ReferenceOption { value: string; group: string; name: string }

export function referenceOptions(refs: Reference[]): ReferenceOption[] {
  return [{ value: "HEAD", group: "HEAD", name: "HEAD" }, ...refs.filter(ref => ref.commitId !== null).map(ref => {
    const group = ref.name.split("/").slice(0, 2).join("/");
    const value = group === "refs/heads" || group === "refs/remotes" || group === "refs/tags"
      ? ref.name.slice(group.length + 1) : ref.name;
    return { value, group, name: ref.name };
  })];
}

export function selectionToken(value: string, caret: number) {
  const start = caret === 0 ? 0 : value.lastIndexOf(",", caret - 1) + 1;
  const next = value.indexOf(",", caret);
  const end = next === -1 ? value.length : next;
  const token = value.slice(start, end).trim();
  return { start, end, negative: token.startsWith("!"), query: token.replace(/^!/, "") };
}

export function completeReference(value: string, caret: number, option: ReferenceOption) {
  const token = selectionToken(value, caret);
  // Full names avoid ambiguous short names when branches and tags overlap.
  const name = option.name === "HEAD" ? "HEAD" : option.name;
  const replacement = `${token.start ? " " : ""}${token.negative ? "!" : ""}${name}`;
  const suffix = value.slice(token.end) || ", ";
  const text = value.slice(0, token.start) + replacement + suffix;
  return { text, caret: token.start + replacement.length + 2 };
}

export function normalizeSelection(value: string): string {
  return value.split(",").map(part => part.trim()).filter(Boolean).join(", ");
}
