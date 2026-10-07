import { useEffect, useState } from "react";
import { defaultLayout, readLayout, writeLayout } from "./layout";
import { readFilesMode, writeFilesMode, type FilesMode } from "./files";
import { readDiffMode, writeDiffMode, readDiffWrap, writeDiffWrap, type DiffMode } from "./diff";

export function useViewerPreferences() {
  const [wrap, setWrap] = useState(() => {
    try { return readDiffWrap(window.localStorage); } catch { return false; }
  });
  useEffect(() => {
    try { writeDiffWrap(window.localStorage, wrap); } catch { /* Storage access can be blocked. */ }
  }, [wrap]);
  const [filesMode, setFilesMode] = useState<FilesMode>(() => {
    try { return readFilesMode(window.localStorage); } catch { return "list"; }
  });
  useEffect(() => {
    try { writeFilesMode(window.localStorage, filesMode); } catch { /* Storage access can be blocked. */ }
  }, [filesMode]);
  const [diffMode, setDiffMode] = useState<DiffMode>(() => {
    try { return readDiffMode(window.localStorage); } catch { return "unified"; }
  });
  useEffect(() => {
    try { writeDiffMode(window.localStorage, diffMode); } catch { /* Storage access can be blocked. */ }
  }, [diffMode]);
  const [layout, setLayout] = useState(() => {
    try { return readLayout(window.localStorage); } catch { return defaultLayout(); }
  });
  useEffect(() => {
    try { writeLayout(window.localStorage, layout); } catch { /* Storage access can be blocked. */ }
  }, [layout]);
  return { wrap, setWrap, filesMode, setFilesMode, diffMode, setDiffMode, layout, setLayout };
}
