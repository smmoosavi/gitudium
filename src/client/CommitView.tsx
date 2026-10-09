import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Failure } from "./Failure";
import { ViewToggle, diffOptions, filesOptions } from "./ViewToggle";
import { ChangedFiles } from "./ChangedFiles";
import { filePaths, type FilesMode } from "./files";
import { DiffPatch } from "./DiffPatch";
import { effectiveDiffMode, type DiffMode } from "./diff";
import { focusNavigationTarget, type FocusedPane } from "./navigation";
import type { DetailNavigationAdapter } from "./useKeyboardNavigation";
import { formatDate } from "./date";
import { canShowFullFile, contextPageSize, type ContextExpansion } from "./diffContext";
import { useSyntaxHighlighting } from "./useSyntaxHighlighting";

export function CommitView({ id, diffMode, onDiffModeChange, filesMode, onFilesModeChange, wrap, onWrapChange, focusedPane, onPaneFocus, navigationRef }: {
  navigationRef: RefObject<DetailNavigationAdapter | null>;
  focusedPane: FocusedPane; onPaneFocus: (pane: FocusedPane) => void;
  wrap: boolean; onWrapChange: (wrap: boolean) => void;
  id: string; diffMode: DiffMode; onDiffModeChange: (mode: DiffMode) => void;
  filesMode: FilesMode; onFilesModeChange: (mode: FilesMode) => void;
}) {
  const [selectedPath, setPath] = useState<string | null>(null);
  const commit = useQuery({ queryKey: ["commit", id], staleTime: Infinity, queryFn: ({ signal }) => api.commit.query({ revision: id }, { signal }), retry: false });
  const paths = filePaths(commit.data?.files ?? [], filesMode);
  const path = selectedPath ?? paths[0] ?? null;
  const diff = useQuery({
    queryKey: ["diff", id, path], enabled: path !== null, staleTime: Infinity,
    queryFn: ({ signal }) => api.diff.query({ revision: id, path: path! }, { signal }), retry: false,
  });
  const [stableSourceKey, setStableSourceKey] = useState<string | null>(null);
  const sourceKey = `${id}:${path}`;
  useEffect(() => {
    const timer = setTimeout(() => setStableSourceKey(sourceKey), 100);
    return () => clearTimeout(timer);
  }, [sourceKey]);
  const sources = useQuery({
    queryKey: ["sources", id, path], staleTime: Infinity, gcTime: 0,
    enabled: path !== null && stableSourceKey === sourceKey && diff.data?.state === "text",
    queryFn: ({ signal }) => api.sources.query({ revision: id, path: path! }, { signal }), retry: false,
  });
  const [contextView, setContextView] = useState<{ key: string; expansion: ContextExpansion; full: boolean }>({ key: "", expansion: {}, full: false });
  const context = contextView.key === sourceKey ? contextView : { key: sourceKey, expansion: {}, full: false };
  const textSources = sources.data?.state === "text" ? sources.data : undefined;
  const syntax = useSyntaxHighlighting(textSources);
  const fullAllowed = textSources !== undefined && canShowFullFile(textSources);
  const expand = (gap: string, direction: "above" | "below") => setContextView(previous => {
    const current = previous.key === sourceKey ? previous : { key: sourceKey, expansion: {}, full: false };
    const extent = current.expansion[gap] ?? { above: 0, below: 0 };
    return { ...current, expansion: { ...current.expansion, [gap]: { ...extent, [direction]: extent[direction] + contextPageSize } } };
  });
  const filesRef = useRef<HTMLElement>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  const pendingFilesEdge = useRef<"start" | undefined>(undefined);
  useEffect(() => {
    if (selectedPath === null && path !== null) setPath(path);
  }, [selectedPath, path]);
  useLayoutEffect(() => {
    navigationRef.current = {
      count: paths.length,
      selectedIndex: paths.indexOf(path ?? ""),
      apply: action => {
        if (action.index !== undefined) setPath(paths[action.index]!);
        if (action.pane === "diff" && path === null && paths.length) setPath(paths[0]!);
        pendingFilesEdge.current = action.pane === "files" && action.edge === "start" ? "start" : undefined;
        const diffContent = diffRef.current;
        if (diffContent && action.pane === "diff") {
          if (action.pane === "diff" && action.index !== undefined && paths[action.index] !== path) diffContent.scrollTo({ top: 0 });
          if (action.scroll !== undefined) diffContent.scrollBy({ top: action.scroll });
          if (action.page !== undefined) diffContent.scrollBy({ top: action.page * diffContent.clientHeight });
          if (action.edge !== undefined) diffContent.scrollTo({ top: action.edge === "start" ? 0 : diffContent.scrollHeight });
        }
        onPaneFocus(action.pane);
        focusNavigationTarget(filesRef.current?.parentElement ?? null, action.pane, action.index, true, action.edge);
      },
    };
    return () => { navigationRef.current = null; };
  }, [commit.data, filesMode, focusedPane, onPaneFocus, path, navigationRef]);
  useEffect(() => {
    focusNavigationTarget(filesRef.current?.parentElement ?? null, "files", undefined, focusedPane === "files", pendingFilesEdge.current);
    pendingFilesEdge.current = undefined;
  }, [path, focusedPane, filesMode]);
  if (commit.isPending || commit.isError) return <>
    <section className="files-panel" aria-label="Commit details and changed files">{commit.isPending ? <p className="empty-hint" role="status">Loading commit…</p> : <Failure error={commit.error} retry={() => void commit.refetch()} />}</section>
    <section className="diff-panel" aria-label="File diff"><p className="empty-hint">Select a changed file to load its diff.</p></section>
  </>;
  const details = commit.data;
  const renderedMode = effectiveDiffMode(diffMode, details.files.find(file => file.path === path)?.status);
  return <>
    <section ref={filesRef} className={`files-panel${focusedPane === "files" ? " pane-focused" : ""}`} aria-label="Commit details and changed files" onPointerDown={() => { if (details.files.length) onPaneFocus("files"); }} onFocusCapture={() => { if (details.files.length) onPaneFocus("files"); }}>
    <div className="panel-heading"><h2>Commit details</h2><code>{details.shortId}</code></div>
    <div className="commit-summary">
    <h3>{details.subject || "(No subject)"}</h3>
    <code className="object-id">{details.id}</code>
    <p>{details.author.name} &lt;{details.author.email}&gt; · <time dateTime={details.author.date} title={details.author.date}>{formatDate(details.author.date)}</time></p>
    <pre className="message">{details.message}</pre>
    <p className="muted">{details.parents.length > 1 ? "Merge: changes compared with the first parent." : details.diffBase ? "Changes compared with the parent commit." : "Root commit: changes compared with the empty tree."}</p>
    </div>
    <div className="panel-heading files-heading"><h3>Changed files</h3><span className="count">{details.files.length}</span><ViewToggle label="Changed files view" value={filesMode} options={filesOptions} onChange={onFilesModeChange} /></div>
    {!details.files.length && <p className="empty-hint">No changed files.</p>}
    <ChangedFiles files={details.files} mode={filesMode} selected={path} onSelect={setPath} />
    </section>
    <section className={`diff-panel${focusedPane === "diff" ? " pane-focused" : ""}`} aria-label="File diff" onPointerDown={() => { if (path !== null) onPaneFocus("diff"); }} onFocusCapture={() => { if (path !== null) onPaneFocus("diff"); }}>
    <div className="panel-heading diff-heading"><h3>File diff{path !== null && <> · <code>{path}</code></>}</h3><div className="diff-controls">{textSources && <button type="button" disabled={!fullAllowed} title={!fullAllowed ? "Full-file view exceeds the 20,000 line rendering limit; expand context in smaller sections." : undefined} aria-pressed={context.full} onClick={() => setContextView({ ...context, full: !context.full })}>{context.full ? "Hunks only" : "Full file"}</button>}{renderedMode !== diffMode && <span className="muted">Added/deleted file · Unified</span>}<button type="button" className="wrap-toggle" aria-label="Wrap diff lines" title="Wrap diff lines" aria-pressed={wrap} onClick={() => onWrapChange(!wrap)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h18M3 10h14a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 14h5M3 18h5" /></svg></button><ViewToggle label="Diff view" value={diffMode} options={diffOptions} onChange={onDiffModeChange} /></div></div>
    <div ref={diffRef} className="diff-content" tabIndex={0} role="region" aria-label="Diff content">
    {path === null ? <p>Select a changed file to load its diff.</p>
      : diff.isPending ? <p role="status">Loading diff…</p>
      : diff.isError ? <Failure error={diff.error} retry={() => void diff.refetch()} />
      : diff.data.state === "binary" ? <p role="status">Binary file: no text diff is available.</p>
      : diff.data.state === "oversized" ? <p role="status">Diff exceeds the {diff.data.limitBytes.toLocaleString()} byte limit.</p>
      : <>
        {sources.isFetching && <p role="status">Loading file context…</p>}
        {sources.isError && <Failure error={sources.error} retry={() => void sources.refetch()} />}
        {sources.data?.state === "oversized" && <p role="status">File context exceeds the {sources.data.limitBytes.toLocaleString()} byte limit per side. Showing patch only.</p>}
        {(sources.data?.state === "binary" || sources.data?.state === "unavailable") && <p role="status">File context is unavailable. Showing patch only.</p>}
        {!diff.data.patch && <p>No textual changes.</p>}
        <DiffPatch key={sourceKey} patch={diff.data.patch} mode={renderedMode} wrap={wrap} syntax={syntax} sources={textSources} expansion={context.expansion} full={context.full} onExpand={expand} />
      </>}
    </div>
    </section>
  </>;
}

