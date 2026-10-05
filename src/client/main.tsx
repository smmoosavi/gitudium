import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommitList, type CommitListHandle } from "./CommitList";
import { nextHistoryCursor } from "./history";
import { HISTORY_CHUNK_SIZE } from "../repository/limits";
import { createLiveRefresh } from "./live";
import { connectEvents, loadAccessToken } from "./access";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { HistoryCursor } from "../repository/types";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/router";
import { defaultLayout, readLayout, writeLayout } from "./layout";
import { ViewToggle, layoutOptions, diffOptions, filesOptions } from "./ViewToggle";
import { ChangedFiles } from "./ChangedFiles";
import { readFilesMode, writeFilesMode, type FilesMode } from "./files";
import { ResizeHandle } from "./ResizeHandle";
import { DiffPatch } from "./DiffPatch";
import { effectiveDiffMode, readDiffMode, writeDiffMode, readDiffWrap, writeDiffWrap, type DiffMode } from "./diff";
import { focusNavigationTarget, ignoresNavigation, navigationAction, navigationKey, parentNavigationAction, type FocusedPane } from "./navigation";
import { filePaths } from "./files";
import "./style.css";

const token = loadAccessToken(window.location, {
  getItem: key => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
}, url => window.history.replaceState(null, "", url));
const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc", headers: () => token ? { Authorization: `Bearer ${token}` } : {} })],
});
const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="failure" role="alert"><p>{error.message}</p><button onClick={retry}>Retry</button></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function CommitView({ id, diffMode, onDiffModeChange, filesMode, onFilesModeChange, wrap, onWrapChange, focusedPane, onPaneFocus }: {
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
  const filesRef = useRef<HTMLElement>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedPath === null && path !== null) setPath(path);
  }, [selectedPath, path]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (ignoresNavigation(event) || (focusedPane === "commits" && navigationKey(event.key) !== "l")) return;
      const action = navigationAction(focusedPane, event.key, paths.length, paths.indexOf(path ?? ""), paths.length);
      if (!action) return;
      event.preventDefault();
      if (action.index !== undefined) setPath(paths[action.index]!);
      if (action.pane === "diff" && path === null && paths.length) setPath(paths[0]!);
      const diffContent = diffRef.current;
      if (diffContent) {
        if (action.pane === "diff" && action.index !== undefined && paths[action.index] !== path) diffContent.scrollTo({ top: 0 });
        if (action.scroll !== undefined) diffContent.scrollBy({ top: action.scroll });
        if (action.page !== undefined) diffContent.scrollBy({ top: action.page * diffContent.clientHeight });
        if (action.edge !== undefined) diffContent.scrollTo({ top: action.edge === "start" ? 0 : diffContent.scrollHeight });
      }
      onPaneFocus(action.pane);
      focusNavigationTarget(filesRef.current?.parentElement ?? null, action.pane, action.index);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [commit.data, filesMode, focusedPane, onPaneFocus, path]);
  useEffect(() => {
    focusNavigationTarget(filesRef.current?.parentElement ?? null, "files", undefined, focusedPane === "files");
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
    <div className="panel-heading diff-heading"><h3>File diff{path !== null && <> · <code>{path}</code></>}</h3><div className="diff-controls">{renderedMode !== diffMode && <span className="muted">Added/deleted file · Unified</span>}<button type="button" className="wrap-toggle" aria-label="Wrap diff lines" title="Wrap diff lines" aria-pressed={wrap} onClick={() => onWrapChange(!wrap)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h18M3 10h14a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 14h5M3 18h5" /></svg></button><ViewToggle label="Diff view" value={diffMode} options={diffOptions} onChange={onDiffModeChange} /></div></div>
    <div ref={diffRef} className="diff-content" tabIndex={0} role="region" aria-label="Diff content">
    {path === null ? <p>Select a changed file to load its diff.</p>
      : diff.isPending ? <p role="status">Loading diff…</p>
      : diff.isError ? <Failure error={diff.error} retry={() => void diff.refetch()} />
      : diff.data.state === "binary" ? <p role="status">Binary file: no text diff is available.</p>
      : diff.data.state === "oversized" ? <p role="status">Diff exceeds the {diff.data.limitBytes.toLocaleString()} byte limit.</p>
      : !diff.data.patch ? <p>No textual changes.</p>
      : <DiffPatch patch={diff.data.patch} mode={renderedMode} wrap={wrap} />}
    </div>
    </section>
  </>;
}

function App() {
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
  const viewerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => {
    try { return readLayout(window.localStorage); } catch { return defaultLayout(); }
  });
  useEffect(() => {
    try { writeLayout(window.localStorage, layout); } catch { /* Storage access can be blocked. */ }
  }, [layout]);
  const { mode } = layout;
  const sizes = layout.sizes[mode];
  const resize = (axis: "primary" | "secondary", value: number) => setLayout(current => ({
    ...current, sizes: { ...current.sizes, [current.mode]: { ...current.sizes[current.mode], [axis]: value } },
  }));
  const split = (value: number) => `minmax(0, ${value}fr) 6px minmax(0, ${100 - value}fr)`;
  const columns = mode === "columns"
    ? `minmax(0, ${sizes.primary}fr) 6px minmax(0, ${(100 - sizes.primary) * sizes.secondary / 100}fr) 6px minmax(0, ${(100 - sizes.primary) * (100 - sizes.secondary) / 100}fr)`
    : split(sizes.primary);
  const [revision, setRevision] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<FocusedPane>("commits");
  const historyRef = useRef<HTMLElement>(null);
  const commitListRef = useRef<CommitListHandle>(null);
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  useEffect(() => {
    const refresh = createLiveRefresh(queryClient);
    const close = connectEvents(token!, () => { void refresh.refresh(); }, setConnection);
    return () => { close(); refresh.close(); };
  }, []);
  const metadata = useQuery({ queryKey: ["metadata"], queryFn: ({ signal }) => api.metadata.query(undefined, { signal }), retry: false });
  const references = useQuery({ queryKey: ["references"], enabled: metadata.isSuccess, queryFn: ({ signal }) => api.references.query(undefined, { signal }), retry: false });
  const history = useInfiniteQuery({
    queryKey: ["history", revision], enabled: metadata.isSuccess && references.isSuccess, initialPageParam: undefined as HistoryCursor | undefined,
    queryFn: ({ pageParam, signal }) => api.history.query({ revision: pageParam ? undefined : revision || undefined, limit: HISTORY_CHUNK_SIZE, cursor: pageParam }, { signal }),
    getNextPageParam: nextHistoryCursor, retry: false,
  });
  const commits = useMemo(() => history.data?.pages.flatMap(page => page.commits) ?? [], [history.data]);
  const loadMoreHistory = useCallback(() => { void history.fetchNextPage(); }, [history.fetchNextPage]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const key = navigationKey(event.key);
      if (ignoresNavigation(event)) return;
      const index = commits.findIndex(commit => commit.id === selected);
      const action = focusedPane === "files"
        ? parentNavigationAction(focusedPane, key, commits.length, index)
        : focusedPane === "commits" && (key === "j" || key === "k")
          ? navigationAction("commits", key, commits.length, index, 0)
          : null;
      if (action?.index === undefined) return;
      event.preventDefault();
      setSelected(commits[action.index]!.id);
      commitListRef.current?.reveal(action.index, action.pane === "commits");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [commits, selected, focusedPane]);
  useEffect(() => {
    const index = commits.findIndex(commit => commit.id === selected);
    commitListRef.current?.reveal(index, focusedPane === "commits" && selected !== null);
  }, [selected, focusedPane]);
  const repositoryPath = metadata.data?.root ?? metadata.data?.gitDirectory;
  const repositoryName = repositoryPath?.split(/[\\/]/).filter(Boolean).at(-1);
  return <main className="app-shell">
    <header className="app-header">
      <div className="brand-mark" aria-hidden="true">G</div><h1>Gitudium</h1><span className="header-divider" />
      <span className="project-name">{repositoryName ?? "Git workspace"}</span>
      <span className="read-only">Read-only</span>
    </header>
    <div className="workspace-bar"><span className="workspace-tab">Git</span><span className="workspace-caption">Repository history</span>
      <div className="layout-control"><span>Layout</span><ViewToggle label="Viewer layout" value={mode} options={layoutOptions} onChange={mode => setLayout(current => ({ ...current, mode }))} /></div>
    </div>
    <div className="repository-bar">
    {metadata.isPending ? <p role="status">Loading repository…</p> : metadata.isError ? <Failure error={metadata.error} retry={() => void metadata.refetch()} /> : <p className="repository"><strong title={repositoryPath}>{repositoryPath}</strong><span className="branch-label">⑂ {metadata.data.branch ?? (metadata.data.head ? "Detached HEAD" : "No commits yet")}</span>{metadata.data.bare && <span className="muted">Bare repository</span>}</p>}
    </div>
    <div ref={viewerRef} className={`viewer layout-${mode}`} style={{ gridTemplateColumns: columns, gridTemplateRows: mode === "columns" ? "minmax(0, 1fr)" : split(sizes.secondary) }}>
      <section ref={historyRef} className={`history-panel${focusedPane === "commits" ? " pane-focused" : ""}`} aria-labelledby="history-title" onPointerDown={() => setFocusedPane("commits")} onFocusCapture={() => setFocusedPane("commits")}>
        <div className="panel-heading"><h2 id="history-title">Log</h2></div>
        <div className="history-toolbar"><label htmlFor="reference">⑂ Reference</label>
        <select id="reference" value={revision} onChange={event => { setRevision(event.target.value); setSelected(null); setFocusedPane("commits"); }}>
          <option value="">All references + HEAD</option>
          {revision && references.isSuccess && !references.data.some(ref => ref.name === revision && ref.commitId !== null) && <option value={revision}>{revision} (unavailable)</option>}
          {references.data?.filter(ref => ref.commitId !== null).map(ref => <option key={ref.name} value={ref.name}>{ref.name}</option>)}
        </select></div>
        {references.isPending && <p role="status">Loading references…</p>}
        {references.isError && <Failure error={references.error} retry={() => void references.refetch()} />}
        <p className="muted">Topological order</p>
        {history.isPending && <p role="status">Loading history…</p>}
        {history.isError && <Failure error={history.error} retry={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())} />}
        {history.isSuccess && commits.length === 0 && <p>No commits in this history.</p>}
        <CommitList key={revision} ref={commitListRef} commits={commits} head={metadata.data?.head} selected={selected} onSelect={setSelected}
          canLoadMore={history.hasNextPage && !history.isFetching && !history.isError} onLoadMore={loadMoreHistory} />
        {history.isFetchingNextPage && <p role="status">Loading more history…</p>}
      </section>
      <ResizeHandle className="primary-resizer" axis="vertical" viewer={viewerRef} value={sizes.primary} initial={defaultLayout().sizes[mode].primary} label="Resize commit log" onChange={value => resize("primary", value)} />
      <ResizeHandle className="secondary-resizer" axis={mode === "columns" ? "vertical" : "horizontal"} viewer={viewerRef} offset={mode === "columns" ? sizes.primary : 0} value={sizes.secondary} initial={defaultLayout().sizes[mode].secondary} label={mode === "columns" ? "Resize files and diff" : "Resize upper panes and diff"} onChange={value => resize("secondary", value)} />
      {selected ? <CommitView key={selected} id={selected} diffMode={diffMode} onDiffModeChange={setDiffMode} filesMode={filesMode} onFilesModeChange={setFilesMode} wrap={wrap} onWrapChange={setWrap} focusedPane={focusedPane} onPaneFocus={setFocusedPane} /> : <>
        <section className="files-panel" aria-label="Commit details and changed files"><div className="panel-heading"><h2>Commit details</h2></div><p className="empty-hint">Select a commit to inspect its changed files.</p></section>
        <section className="diff-panel" aria-label="File diff"><div className="panel-heading"><h2>File diff</h2></div><div className="empty-state"><span className="empty-icon" aria-hidden="true">⑂</span><h3>Explore your repository</h3><p>Select a commit from the log to inspect its<br />changed files and diffs.</p><span className="empty-note">Local repository · Read-only access</span></div></section>
      </>}
    </div>
    <footer className="status-bar"><span className={`connection ${connection}`} role="status"><span className="status-dot" aria-hidden="true" />{connection === "connected" ? "Live updates connected" : connection === "connecting" ? "Connecting live updates…" : "Disconnected — reconnecting. Displayed data may be stale."}</span><span>Git · Read-only</span></footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {token ? <App /> : <main><h1>Gitudium</h1><p role="alert">Access token missing or invalid. Open the full URL printed by Gitudium in this tab.</p></main>}
    </QueryClientProvider>
  </StrictMode>,
);
