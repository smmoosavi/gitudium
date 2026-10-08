import { RepositoryError, type ChangedFile, type CommitDetails, type CommitSummary, type Reference } from "./types";

export const SUMMARY_FORMAT = "%H%x00%h%x00%P%x00%s%x00%an%x00%ae%x00%aI";
export const DETAILS_FORMAT = `${SUMMARY_FORMAT}%x00%cn%x00%ce%x00%cI%x00%B`;

function malformed(): never {
  throw new RepositoryError("GIT_FAILED", "Malformed Git output.");
}

function records(output: string, width: number): string[] {
  if (!output) return [];
  if (!output.endsWith("\0")) malformed();
  const fields = output.slice(0, -1).split("\0");
  if (fields.length % width) malformed();
  return fields;
}

export function parseReferences(output: string): Reference[] {
  return output.split("\n").filter(Boolean).map(line => {
    const fields = line.split("\0");
    if (fields.length !== 6 || !fields[0] || !fields[1] || !fields[2]) malformed();
    const [name, objectId, type, peeled, peeledType, symbolicTarget] = fields;
    return {
      name, objectId, kind: name.startsWith("refs/heads/") ? "branch" : name.startsWith("refs/remotes/") ? "remote" : "tag",
      commitId: type === "commit" ? objectId : peeledType === "commit" ? peeled : null,
      symbolicTarget: symbolicTarget || null,
    };
  });
}

export function referenceNames(refs: Reference[]): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const ref of refs) {
    if (ref.commitId === null) continue;
    const attached = names.get(ref.commitId);
    if (attached) attached.push(ref.name);
    else names.set(ref.commitId, [ref.name]);
  }
  return names;
}

function summary(fields: string[], refs: Map<string, string[]>): CommitSummary {
  const [id, shortId, parents, subject, name, email, date] = fields;
  if (!id || !shortId || !date) malformed();
  return { id, shortId, parents: parents ? parents.split(" ") : [], subject,
    author: { name, email, date }, references: refs.get(id) ?? [] };
}

export function parseSummaries(output: string, refs: Map<string, string[]>): CommitSummary[] {
  const fields = records(output, 7);
  const commits: CommitSummary[] = [];
  for (let i = 0; i < fields.length; i += 7) commits.push(summary(fields.slice(i, i + 7), refs));
  return commits;
}

export function parseDetails(output: string, refs: Map<string, string[]>): Omit<CommitDetails, "files"> {
  const fields = records(output, 11);
  if (fields.length !== 11 || !fields[9]) malformed();
  const commit = summary(fields, refs);
  return { ...commit, committer: { name: fields[7], email: fields[8], date: fields[9] },
    message: fields[10], diffBase: commit.parents[0] ?? null };
}

export function parseChangedFiles(output: string): ChangedFile[] {
  const fields = records(output, 2);
  const statuses: Record<string, ChangedFile["status"]> = { A: "added", M: "modified", D: "deleted", T: "type-changed" };
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const status = Object.hasOwn(statuses, fields[i]) ? statuses[fields[i]] : undefined;
    if (!status) throw new RepositoryError("GIT_FAILED", "Unsupported changed-file status.");
    if (!fields[i + 1]) malformed();
    files.push({ path: fields[i + 1], previousPath: null, status });
  }
  return files;
}
