import type { ChangedFile } from "../repository/types";

export type FilesMode = "tree" | "list";
export const filesStorageKey = "gitudium.files-mode.v1";
export function readFilesMode(storage: Pick<Storage, "getItem">): FilesMode {
  try { return storage.getItem(filesStorageKey) === "tree" ? "tree" : "list"; }
  catch { return "list"; }
}
export function writeFilesMode(storage: Pick<Storage, "setItem">, mode: FilesMode) {
  try { storage.setItem(filesStorageKey, mode); } catch { /* Storage can be blocked or full. */ }
}

export type FileNode = { name: string; path: string; file: ChangedFile };
export type FolderNode = { name: string; path: string; children: FilesNode[] };
export type FilesNode = FileNode | FolderNode;

export function filePaths(files: ChangedFile[], mode: FilesMode): string[] {
  if (mode === "list") return files.map(file => file.path);
  const flatten = (nodes: FilesNode[]): string[] => nodes.flatMap(node => "children" in node ? flatten(node.children) : [node.path]);
  return flatten(buildFileTree(files));
}

export function buildFileTree(files: ChangedFile[]): FilesNode[] {
  const root: FolderNode = { name: "", path: "", children: [] };
  const folders = new Map<string, FolderNode>([["", root]]);
  for (const file of files) {
    const parts = file.path.split("/");
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let folder = folders.get(path);
      if (!folder) {
        folder = { name: parts[i]!, path, children: [] };
        folders.set(path, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ name: parts.at(-1)!, path: file.path, file });
  }
  const sort = (nodes: FilesNode[]) => {
    nodes.sort((a, b) => Number("children" in b) - Number("children" in a) || a.name.localeCompare(b.name));
    for (const node of nodes) if ("children" in node) sort(node.children);
  };
  sort(root.children);
  return root.children;
}
