import type { ChangedFile } from "../repository/types";

export function FileChangeSummary({ file }: { file: ChangedFile }) {
  if (file.additions === null || file.deletions === null) return <span className="file-change-summary" title="Binary file; line counts unavailable">Binary</span>;
  if (file.additions === undefined || file.deletions === undefined) return null;
  return <span className="file-change-summary" aria-label={`${file.additions} lines added, ${file.deletions} lines deleted`}>
    <span className="added-count">+{file.additions}</span><span className="deleted-count">−{file.deletions}</span>
  </span>;
}
