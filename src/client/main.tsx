import { StrictMode, useEffect, useRef, useState } from "react";
import type { CommitListHandle } from "./CommitList";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultLayout } from "./layout";
import { ViewToggle, layoutOptions } from "./ViewToggle";
import { ResizeHandle } from "./ResizeHandle";
import type { FocusedPane } from "./navigation";
import { useKeyboardNavigation, type DetailNavigationAdapter } from "./useKeyboardNavigation";
import { token } from "./api";
import { Failure } from "./Failure";
import { CommitView } from "./CommitView";
import { HistoryPane } from "./HistoryPane";
import { useRepositoryQueries } from "./useRepositoryQueries";
import { useLiveConnection } from "./useLiveConnection";
import { useViewerPreferences } from "./useViewerPreferences";
import "./style.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function App() {
  const { wrap, setWrap, filesMode, setFilesMode, diffMode, setDiffMode, layout, setLayout } = useViewerPreferences();
  const viewerRef = useRef<HTMLDivElement>(null);
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
  const connection = useLiveConnection(token!);
  const { metadata, references, history, commits, loadMoreHistory } = useRepositoryQueries(revision);
  const detailNavigationRef = useRef<DetailNavigationAdapter | null>(null);
  useKeyboardNavigation({
    focusedPane,
    commits: {
      count: commits.length,
      selectedIndex: commits.findIndex(commit => commit.id === selected),
      select: index => setSelected(commits[index]!.id),
      reveal: (index, focus) => commitListRef.current?.reveal(index, focus),
    },
    details: detailNavigationRef,
    focusReferences: () => historyRef.current?.querySelector<HTMLInputElement>("#reference")?.focus(),
  });
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
    </header>
    <div className="workspace-bar">
      <div className="repository-info">
        {metadata.isPending ? <p role="status">Loading repository…</p> : metadata.isError ? <Failure error={metadata.error} retry={() => void metadata.refetch()} /> : <p className="repository"><span className="repository-path" title={repositoryPath}>{repositoryPath}</span><span className="ref-label" title={metadata.data.branch ?? undefined}>{metadata.data.branch ?? (metadata.data.head ? "Detached HEAD" : "No commits yet")}</span>{metadata.data.bare && <span className="muted">Bare repository</span>}</p>}
      </div>
      <div className="layout-control"><span>Layout</span><ViewToggle label="Viewer layout" value={mode} options={layoutOptions} onChange={mode => setLayout(current => ({ ...current, mode }))} /></div>
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
      {selected ? <CommitView key={selected} navigationRef={detailNavigationRef} id={selected} diffMode={diffMode} onDiffModeChange={setDiffMode} filesMode={filesMode} onFilesModeChange={setFilesMode} wrap={wrap} onWrapChange={setWrap} focusedPane={focusedPane} onPaneFocus={setFocusedPane} /> : <>
        <section className="files-panel" aria-label="Commit details and changed files"><div className="panel-heading"><h2>Commit details</h2></div><p className="empty-hint">Select a commit to inspect its changed files.</p></section>
        <section className="diff-panel" aria-label="File diff"><div className="panel-heading"><h2>File diff</h2></div><div className="empty-state"><span className="brand-mark empty-icon" aria-hidden="true">G</span><h3>Explore your repository</h3><p>Select a commit from the log to inspect its<br />changed files and diffs.</p></div></section>
      </>}
    </div>
    <footer className="status-bar"><span className={`connection ${connection}`} role="status"><span className="status-dot" aria-hidden="true" />{connection === "connected" ? "Live updates connected" : connection === "connecting" ? "Connecting live updates…" : "Disconnected — reconnecting. Displayed data may be stale."}</span></footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {token ? <App /> : <main><h1>Gitudium</h1><p role="alert">Access token missing or invalid. Open the full URL printed by Gitudium in this tab.</p></main>}
    </QueryClientProvider>
  </StrictMode>,
);
