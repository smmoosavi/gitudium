import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Failure } from "./Failure";
import { ViewToggle, diffOptions, filesOptions } from "./ViewToggle";
import { ChangedFiles } from "./ChangedFiles";
import { FileChangeSummary } from "./FileChangeSummary";
import { filePaths, type FilesMode } from "./files";
import { DiffPatch } from "./DiffPatch";
import { effectiveDiffMode, type WhitespaceMode, type DiffMode } from "./diff";
import { viewerPreferences } from "./preferences";
import { usePreference } from "./usePreference";
import { focusNavigationTarget, type FocusedPane } from "./navigation";
import type { DetailNavigationAdapter } from "./useKeyboardNavigation";
import { formatDate } from "./date";
import { canShowFullFile, contextPageSize, type ContextExpansion } from "./diffContext";
import { useSyntaxHighlighting } from "./useSyntaxHighlighting";
import type { SyntaxService } from "./syntaxService";
import { diffModeChange, pairedDiffEngine } from "./diffEngine";
import { sameFileDiffPlaceholder } from "./diffQuery";
import { useSyntaxMatcher } from "./useSyntaxMatcher";
import { DiffOptions } from "./DiffOptions";
import type { LocalChanges, LocalScope } from "../repository/types";
import { localFiles, localScopes } from "./localChanges";
import { LocalChangesTabs } from "./LocalChangesTabs";

export function CommitView({ id, local, diffMode, onDiffModeChange, filesMode, onFilesModeChange, wrap, onWrapChange, focusedPane, onPaneFocus, navigationRef, syntaxService }: {
  local?: { changes: LocalChanges; scope: LocalScope; onScopeChange: (scope: LocalScope) => void; refreshing: boolean; onRefresh: () => void };
  syntaxService: SyntaxService;
  navigationRef: RefObject<DetailNavigationAdapter | null>;
  focusedPane: FocusedPane; onPaneFocus: (pane: FocusedPane) => void;
  wrap: boolean; onWrapChange: (wrap: boolean) => void;
  id: string; diffMode: DiffMode; onDiffModeChange: (mode: DiffMode) => void;
  filesMode: FilesMode; onFilesModeChange: (mode: FilesMode) => void;
}) {
  const [selectedPath, setPath] = useState<string | null>(null);
  const [diffAlgorithm, setDiffAlgorithm] = usePreference(viewerPreferences.diffAlgorithm);
  const [gitAlgorithm, setGitAlgorithm] = usePreference(viewerPreferences.gitAlgorithm);
  const [whitespace, setWhitespace] = usePreference(viewerPreferences.whitespace);
  const filtered = whitespace !== "none";
  const commit = useQuery({ queryKey: ["commit", id], enabled: !local, staleTime: Infinity, queryFn: ({ signal }) => api.commit.query({ revision: id }, { signal }), retry: false });
  const files = local ? localFiles(local.changes, local.scope) : commit.data?.files ?? [];
  const paths = filePaths(files, filesMode);
  const retainedPath = local && selectedPath !== null && !local.changes.files.some(file => file.path === selectedPath) ? null : selectedPath;
  const path = retainedPath ?? paths[0] ?? null;
  const selectedFile = files.find(file => file.path === path);
  const comparisonId = local ? `${id}:${local.scope}:${local.changes.version}` : id;
  const diff = useQuery<Awaited<ReturnType<typeof api.diff.query>> & { whitespace: WhitespaceMode }>({
    queryKey: [local ? "localDiff" : "diff", comparisonId, path, whitespace, gitAlgorithm], enabled: path !== null && selectedFile !== undefined, staleTime: Infinity, gcTime: local ? 0 : undefined,
    placeholderData: (previousData, previousQuery) => sameFileDiffPlaceholder(previousData, previousQuery, comparisonId, path),
    queryFn: async ({ signal }) => ({ ...await (local ? api.localDiff.query({ scope: local.scope, path: path!, whitespace, algorithm: gitAlgorithm }, { signal }) : api.diff.query({ revision: id, path: path!, whitespace, algorithm: gitAlgorithm }, { signal })), whitespace }), retry: false,
  });
  const displayedFiltered = diff.data ? diff.data.whitespace !== "none" : filtered;
  const [stableSourceKey, setStableSourceKey] = useState<string | null>(null);
  const sourceKey = `${comparisonId}:${path}`;
  useEffect(() => {
    const timer = setTimeout(() => setStableSourceKey(sourceKey), 100);
    return () => clearTimeout(timer);
  }, [sourceKey]);
  const sources = useQuery({
    queryKey: [local ? "localSources" : "sources", comparisonId, path], staleTime: Infinity, gcTime: 0,
    enabled: path !== null && selectedFile !== undefined && stableSourceKey === sourceKey && diff.data?.state === "text",
    queryFn: ({ signal }) => local ? api.localSources.query({ scope: local.scope, path: path! }, { signal }) : api.sources.query({ revision: id, path: path! }, { signal }), retry: false,
  });
  const [contextView, setContextView] = useState<{ key: string; expansion: ContextExpansion; full: boolean }>({ key: "", expansion: {}, full: false });
  const context = contextView.key === sourceKey ? contextView : { key: sourceKey, expansion: {}, full: false };
  const textSources = sources.data?.state === "text" ? sources.data : undefined;
  const syntax = useSyntaxHighlighting(syntaxService, textSources);
  const syntaxMatcher = useSyntaxMatcher(diffAlgorithm === "syntax", textSources);
  const fullAllowed = textSources !== undefined && canShowFullFile(textSources);
  const contextUnavailable = sources.isError || (sources.data !== undefined && !textSources);
  const expand = (gap: string, direction: "above" | "below") => {
    setStableSourceKey(sourceKey);
    setContextView(previous => {
    const current = previous.key === sourceKey ? previous : { key: sourceKey, expansion: {}, full: false };
    const extent = current.expansion[gap] ?? { above: 0, below: 0 };
    return { ...current, expansion: { ...current.expansion, [gap]: { ...extent, [direction]: extent[direction] + contextPageSize } } };
    });
  };
  const filesRef = useRef<HTMLElement>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  const pendingFilesEdge = useRef<"start" | undefined>(undefined);
  useEffect(() => {
    if (selectedPath !== path) setPath(path);
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
  }, [commit.data, local?.changes, local?.scope, filesMode, focusedPane, onPaneFocus, path, navigationRef]);
  useEffect(() => {
    focusNavigationTarget(filesRef.current?.parentElement ?? null, "files", undefined, focusedPane === "files", pendingFilesEdge.current);
    pendingFilesEdge.current = undefined;
  }, [path, focusedPane, filesMode]);
  if (!local && (commit.isPending || commit.isError)) return <>
    <section className="files-panel" aria-label="Commit details and changed files">{commit.isPending ? <p className="empty-hint" role="status">Loading commit…</p> : <Failure error={commit.error} retry={() => void commit.refetch()} />}</section>
    <section className="diff-panel" aria-label="File diff"><p className="empty-hint">Select a changed file to load its diff.</p></section>
  </>;
  const details = commit.data!;
  const renderedMode = effectiveDiffMode(diffMode, selectedFile?.status);
  const modeChange = diff.data?.state === "text" ? diffModeChange(diff.data.patch) : undefined;
  return <>
    <section ref={filesRef} className={`files-panel${focusedPane === "files" ? " pane-focused" : ""}`} aria-label={local ? "Local changes and changed files" : "Commit details and changed files"} onPointerDown={() => { if (files.length) onPaneFocus("files"); }} onFocusCapture={() => { if (files.length) onPaneFocus("files"); }}>
    {local ? <>
      <div className="panel-heading"><h2>Local changes</h2><button type="button" className="local-refresh" aria-label="Refresh local changes" disabled={local.refreshing} onClick={local.onRefresh}>↻ Refresh</button></div>
      <div className="local-summary"><p>{local.scope === "all" ? local.changes.head ? "HEAD → Working tree · Staged and unstaged changes together, plus untracked files." : "No commits yet · Showing changes against an empty tree." : localScopes.find(option => option.value === local.scope)!.description}</p><span className="muted">Read-only · Updates automatically</span></div>
      <LocalChangesTabs changes={local.changes} scope={local.scope} onChange={local.onScopeChange} />
    </> : <><div className="panel-heading"><h2>Commit details</h2><code>{details.shortId}</code></div>
    <div className="commit-summary">
    <h3>{details.subject || "(No subject)"}</h3>
    <code className="object-id">{details.id}</code>
    <p>{details.author.name} &lt;{details.author.email}&gt; · <time dateTime={details.author.date} title={details.author.date}>{formatDate(details.author.date)}</time></p>
    <pre className="message">{details.message}</pre>
    <p className="muted">{details.parents.length > 1 ? "Merge: changes compared with the first parent." : details.diffBase ? "Changes compared with the parent commit." : "Root commit: changes compared with the empty tree."}</p>
    </div></>}
    <div id={local ? "local-files" : undefined} role={local ? "tabpanel" : undefined} aria-labelledby={local ? `local-tab-${local.scope}` : undefined}>
    <div className="panel-heading files-heading"><h3>Changed files</h3><span className="count">{files.length}</span><ViewToggle label="Changed files view" value={filesMode} options={filesOptions} onChange={onFilesModeChange} /></div>
    {!files.length && <p className="empty-hint">{local ? local.scope === "all" ? "Working tree clean. No local changes." : `No ${local.scope} changes.` : "No changed files."}</p>}
    <ChangedFiles files={files} mode={filesMode} selected={path} onSelect={setPath} />
    </div>
    </section>
    <section className={`diff-panel${focusedPane === "diff" ? " pane-focused" : ""}`} aria-label="File diff" onPointerDown={() => { if (path !== null) onPaneFocus("diff"); }} onFocusCapture={() => { if (path !== null) onPaneFocus("diff"); }}>
    <div className="panel-heading diff-heading"><h3>File diff{path !== null && <> · <code>{selectedFile?.previousPath ? `${selectedFile.previousPath} → ${path}` : path}</code></>}{selectedFile && <><span className="diff-file-detail">{selectedFile.status}</span><FileChangeSummary file={selectedFile} /></>}{modeChange && <span className="diff-file-detail">{modeChange}</span>}</h3><div className="diff-controls">{<button type="button" className="full-file-toggle" disabled={path === null || contextUnavailable || (textSources !== undefined && !fullAllowed) || (diff.data !== undefined && diff.data.state !== "text")} title={textSources && !fullAllowed ? "Full-file view exceeds the 20,000 line rendering limit; expand context in smaller sections." : undefined} aria-pressed={context.full} onClick={() => { setStableSourceKey(sourceKey); setContextView({ ...context, full: !context.full }); }}>{context.full ? "Hunks only" : "Full file"}</button>}<button type="button" className="wrap-toggle" aria-label="Wrap diff lines" title="Wrap diff lines" aria-pressed={wrap} onClick={() => onWrapChange(!wrap)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h18M3 10h14a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 14h5M3 18h5" /></svg></button><ViewToggle label="Diff view" value={diffMode} options={diffOptions} onChange={onDiffModeChange} /><DiffOptions alignment={diffAlgorithm} algorithm={gitAlgorithm} whitespace={whitespace} onAlignmentChange={setDiffAlgorithm} onAlgorithmChange={setGitAlgorithm} onWhitespaceChange={setWhitespace} busy={diff.isFetching || syntaxMatcher.pending} status={syntaxMatcher.pending ? "Computing syntax-aware diff…" : syntaxMatcher.unavailable ? "Using Simple for this file: syntax-aware matching unavailable." : diff.isFetching ? "Updating diff…" : undefined} /></div></div>
    <div ref={diffRef} className="diff-content" tabIndex={0} role="region" aria-label="Diff content" aria-busy={diff.isFetching}>
    {path === null ? <p>Select a changed file to load its diff.</p>
      : !selectedFile ? <p><code>{path}</code> has no changes in this scope. Select another file or switch tabs.</p>
      : diff.isPending ? null
      : diff.isError ? <Failure error={diff.error} retry={() => void diff.refetch()} />
      : diff.data.state === "binary" ? <p role="status">Binary file: no text diff is available.</p>
      : diff.data.state === "oversized" ? <p role="status">Diff exceeds the {diff.data.limitBytes.toLocaleString()} byte limit.</p>
      : <>
        {sources.isError && <Failure error={sources.error} retry={() => void sources.refetch()} />}
        {sources.data?.state === "oversized" && <p role="status">File context exceeds the {sources.data.limitBytes.toLocaleString()} byte limit per side. Showing patch only.</p>}
        {(sources.data?.state === "binary" || sources.data?.state === "unavailable") && <p role="status">File context is unavailable. Showing patch only.</p>}
        {local && "untracked" in selectedFile && selectedFile.untracked && sources.data?.state === "text" && sources.data.after?.text === "" && <p>Empty untracked file.</p>}
        {local && "conflicted" in selectedFile && selectedFile.conflicted && <p role="status">This file has merge conflicts. The All tab compares the current working file with HEAD; resolve conflicts using your editor.</p>}
        {!diff.data.patch && <p>{displayedFiltered ? "No textual changes under the selected whitespace filter." : local?.scope === "all" ? "No net textual changes from HEAD. Staged and unstaged edits may cancel each other; inspect their tabs separately." : "No textual changes."}</p>}
        <DiffPatch key={sourceKey} patch={diff.data.patch} engine={diffAlgorithm === "syntax" ? syntaxMatcher.engine : diffAlgorithm === "paired" ? pairedDiffEngine : undefined} contextEnabled={!displayedFiltered} mode={renderedMode} wrap={wrap} syntax={syntax} sources={textSources} expansion={context.expansion} full={context.full && fullAllowed} onExpand={contextUnavailable ? undefined : expand} />
      </>}
    </div>
    </section>
  </>;
}

