import { gitDiffAlgorithms, whitespaceModes, RepositoryError, type GitDiffAlgorithm, type WhitespaceMode } from "./types";

/** Validate direct-reader options before any comparison IO. */
export function gitDiffFlags(whitespace: WhitespaceMode, algorithm: GitDiffAlgorithm): string[] {
  if (!gitDiffAlgorithms.includes(algorithm)) throw new RepositoryError("INVALID_INPUT", "Unknown Git diff algorithm.");
  if (!whitespaceModes.includes(whitespace)) throw new RepositoryError("INVALID_INPUT", "Unknown whitespace mode.");
  const flags = whitespace === "trailing" ? ["--ignore-space-at-eol"]
    : whitespace === "all" ? ["--ignore-all-space"]
    : whitespace === "all-and-blank-lines" ? ["--ignore-all-space", "--ignore-blank-lines"] : [];
  return [`--diff-algorithm=${algorithm}`, ...flags];
}
