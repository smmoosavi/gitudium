export type RepositoryErrorCode =
  | "GIT_UNAVAILABLE" | "NOT_A_REPOSITORY" | "INVALID_INPUT"
  | "REVISION_NOT_FOUND" | "GIT_FAILED" | "CANCELLED" | "OUTPUT_LIMIT" | "BUSY";

export class RepositoryError extends Error {
  constructor(public readonly code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

export interface RepositoryMetadata {
  root: string | null;
  gitDirectory: string;
  commonDirectory: string;
  bare: boolean;
  head: string | null;
  branch: string | null;
  objectFormat: "sha1" | "sha256";
  capabilities: { history: true; firstParentDiffs: true };
}

export interface Reference {
  name: string;
  kind: "branch" | "remote" | "tag" | "other";
  objectId: string;
  commitId: string | null;
  symbolicTarget: string | null;
}

export interface CommitSummary {
  id: string;
  shortId: string;
  parents: string[];
  subject: string;
  author: { name: string; email: string; date: string };
  references: string[];
}

export interface HistoryCursor {
  snapshot: string;
  offset: number;
}

export interface HistoryQuery {
  /** Comma-separated revisions or ref globs; ! excludes reachable commits. Empty selects all refs and HEAD. */
  revision?: string;
  /** Comma-separated ref patterns omitted from all-ref roots; explicit positive selections override them. */
  exclude?: string;
  limit?: number;
  cursor?: HistoryCursor;
}

export interface HistoryPage {
  commits: CommitSummary[];
  nextCursor: HistoryCursor | null;
}

export interface ChangedFile {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed";
  /** Line counts against the first parent (or empty tree); null denotes binary files. */
  additions?: number | null;
  deletions?: number | null;
}

export interface CommitDetails extends CommitSummary {
  committer: { name: string; email: string; date: string };
  message: string;
  files: ChangedFile[];
  diffBase: string | null;
}

export type WhitespaceMode = "none" | "trailing" | "all" | "all-and-blank-lines";

export type DiffResult =
  | { state: "text"; patch: string }
  | { state: "binary" }
  | { state: "oversized"; limitBytes: number };

export interface SourceFile {
  revision: string;
  path: string;
  text: string;
}

/** Full blob sources against the first parent (or an empty tree for root commits). */
export type SourceResult =
  | { state: "text"; before: SourceFile | null; after: SourceFile | null }
  | { state: "binary" }
  | { state: "oversized"; limitBytes: number }
  | { state: "unavailable" };

export interface RepositoryReader {
  metadata(signal?: AbortSignal): Promise<RepositoryMetadata>;
  references(signal?: AbortSignal): Promise<Reference[]>;
  history(query?: HistoryQuery, signal?: AbortSignal): Promise<HistoryPage>;
  commit(revision: string, signal?: AbortSignal): Promise<CommitDetails>;
  diff(revision: string, path?: string, signal?: AbortSignal, whitespace?: WhitespaceMode): Promise<DiffResult>;
  sources(revision: string, path: string, signal?: AbortSignal): Promise<SourceResult>;
}
