import type { LocalChanges, LocalScope } from "../repository/types";

export const LOCAL_CHANGES_ID = "local-changes";
export const localScopes: { value: LocalScope; label: string; description: string }[] = [
  { value: "all", label: "All", description: "All changes compared with HEAD, including untracked files." },
  { value: "staged", label: "Staged", description: "HEAD → Index · Changes added to the staging area." },
  { value: "unstaged", label: "Unstaged", description: "Index → Working tree · Tracked edits not yet staged." },
  { value: "untracked", label: "Untracked", description: "New files not yet tracked by Git. Ignored files are excluded." },
];

export function localFiles(changes: LocalChanges, scope: LocalScope) {
  return changes.files.filter(file => scope === "all" || file[scope]).map(file => ({
    ...file, status: scope === "staged" ? file.stagedStatus ?? file.status : scope === "unstaged" ? file.unstagedStatus ?? file.status : scope === "untracked" ? "added" as const : file.status,
  }));
}
