import { useMemo } from "react";
import type { ChangedFile } from "../repository/types";
import { buildFileTree, type FilesMode, type FilesNode } from "./files";

export function ChangedFiles({ files, mode, selected, onSelect }: {
  files: ChangedFile[]; mode: FilesMode; selected: string | null; onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const fileButton = (file: ChangedFile, label: string) => <button aria-pressed={selected === file.path} title={file.path} onFocus={() => onSelect(file.path)} onClick={() => onSelect(file.path)}>
    <span className={`file-status ${file.status}`} title={file.status}>{file.status === "type-changed" ? "T" : file.status.charAt(0).toUpperCase()}</span>
    <code>{label}</code><span className="file-kind">{file.status}</span>
  </button>;
  const renderNodes = (nodes: FilesNode[]) => <ul>{nodes.map(node => <li key={node.path}>
    {"children" in node ? <details open><summary title={node.path}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7V5h6l2 2h10v12H3Z" /></svg><code>{node.name}</code></summary>{renderNodes(node.children)}</details>
      : fileButton(node.file, node.name)}
  </li>)}</ul>;
  return mode === "list"
    ? <ul className="files" aria-label="Changed files list">{files.map(file => <li key={file.path}>{fileButton(file, file.path)}</li>)}</ul>
    : <div className="files file-tree" aria-label="Changed files tree">{renderNodes(tree)}</div>;
}
