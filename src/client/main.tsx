import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CommitListHandle } from "./CommitList";
import { nextHistoryCursor } from "./history";
import { HISTORY_CHUNK_SIZE } from "../repository/limits";
import { createLiveRefresh } from "./live";
import { connectEvents } from "./access";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { HistoryCursor } from "../repository/types";
import { defaultLayout, readLayout, writeLayout } from "./layout";
import { ViewToggle, layoutOptions } from "./ViewToggle";
import { readFilesMode, writeFilesMode, type FilesMode } from "./files";
import { ResizeHandle } from "./ResizeHandle";
import { readDiffMode, writeDiffMode, readDiffWrap, writeDiffWrap, type DiffMode } from "./diff";
import { ignoresNavigation, navigationAction, navigationKey, parentNavigationAction, type FocusedPane } from "./navigation";
import { api, token } from "./api";
import { Failure } from "./Failure";
import { CommitView } from "./CommitView";
import { HistoryPane } from "./HistoryPane";
import "./style.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

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
      <HistoryPane historyRef={historyRef} commitListRef={commitListRef} focusedPane={focusedPane} onPaneFocus={setFocusedPane}
        revision={revision} onRevisionChange={value => { setRevision(value); setSelected(null); setFocusedPane("commits"); }}
        references={references.data} referencesPending={references.isPending} referencesSuccess={references.isSuccess}
        referencesError={references.isError ? references.error : null} onReferencesRetry={() => void references.refetch()}
        historyPending={history.isPending} historySuccess={history.isSuccess} historyError={history.isError ? history.error : null}
        onHistoryRetry={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())}
        commits={commits} head={metadata.data?.head} selected={selected} onSelect={setSelected}
        canLoadMore={history.hasNextPage && !history.isFetching && !history.isError} onLoadMore={loadMoreHistory} fetchingNextPage={history.isFetchingNextPage} />
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
