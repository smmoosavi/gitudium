import { StrictMode, useEffect, useRef, useState } from "react";
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
import { effectiveDiffMode, readDiffMode, writeDiffMode, type DiffMode } from "./diff";
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

function CommitView({ id, diffMode, onDiffModeChange, filesMode, onFilesModeChange }: {
  id: string; diffMode: DiffMode; onDiffModeChange: (mode: DiffMode) => void;
  filesMode: FilesMode; onFilesModeChange: (mode: FilesMode) => void;
}) {
  const [path, setPath] = useState<string | null>(null);
  const commit = useQuery({ queryKey: ["commit", id], staleTime: Infinity, queryFn: ({ signal }) => api.commit.query({ revision: id }, { signal }), retry: false });
  const diff = useQuery({
    queryKey: ["diff", id, path], enabled: path !== null, staleTime: Infinity,
    queryFn: ({ signal }) => api.diff.query({ revision: id, path: path! }, { signal }), retry: false,
  });
  if (commit.isPending || commit.isError) return <>
    <section className="files-panel" aria-label="Commit details and changed files">{commit.isPending ? <p className="empty-hint" role="status">Loading commit…</p> : <Failure error={commit.error} retry={() => void commit.refetch()} />}</section>
    <section className="diff-panel" aria-label="File diff"><p className="empty-hint">Select a changed file to load its diff.</p></section>
  </>;
  const details = commit.data;
  const renderedMode = effectiveDiffMode(diffMode, details.files.find(file => file.path === path)?.status);
  return <>
    <section className="files-panel" aria-label="Commit details and changed files">
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
    <section className="diff-panel" aria-label="File diff">
    <div className="panel-heading diff-heading"><h3>File diff{path !== null && <> · <code>{path}</code></>}</h3><div className="diff-controls">{renderedMode !== diffMode && <span className="muted">Added/deleted file · Unified</span>}<ViewToggle label="Diff view" value={diffMode} options={diffOptions} onChange={onDiffModeChange} /></div></div>
    <div className="diff-content">
    {path === null ? <p>Select a changed file to load its diff.</p>
      : diff.isPending ? <p role="status">Loading diff…</p>
      : diff.isError ? <Failure error={diff.error} retry={() => void diff.refetch()} />
      : diff.data.state === "binary" ? <p role="status">Binary file: no text diff is available.</p>
      : diff.data.state === "oversized" ? <p role="status">Diff exceeds the {diff.data.limitBytes.toLocaleString()} byte limit.</p>
      : !diff.data.patch ? <p>No textual changes.</p>
      : <DiffPatch patch={diff.data.patch} mode={renderedMode} />}
    </div>
    </section>
  </>;
}

function App() {
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
    queryFn: ({ pageParam, signal }) => api.history.query({ revision: pageParam ? undefined : revision || undefined, limit: 50, cursor: pageParam }, { signal }),
    getNextPageParam: page => page.nextCursor ?? undefined, retry: false,
  });
  const commits = history.data?.pages.flatMap(page => page.commits) ?? [];
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
      <section className="history-panel" aria-labelledby="history-title">
        <div className="panel-heading"><h2 id="history-title">Log</h2><span className="count">{commits.length} loaded</span></div>
        <div className="history-toolbar"><label htmlFor="reference">⑂ Reference</label>
        <select id="reference" value={revision} onChange={event => { setRevision(event.target.value); setSelected(null); }}>
          <option value="">All references + HEAD</option>
          {revision && references.isSuccess && !references.data.some(ref => ref.name === revision && ref.commitId !== null) && <option value={revision}>{revision} (unavailable)</option>}
          {references.data?.filter(ref => ref.commitId !== null).map(ref => <option key={ref.name} value={ref.name}>{ref.name}</option>)}
        </select></div>
        {references.isPending && <p role="status">Loading references…</p>}
        {references.isError && <Failure error={references.error} retry={() => void references.refetch()} />}
        <p className="muted">Topological order · 50 commits per page</p>
        {history.isPending && <p role="status">Loading history…</p>}
        {history.isError && <Failure error={history.error} retry={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())} />}
        {history.isSuccess && commits.length === 0 && <p>No commits in this history.</p>}
        <ol className="commits">{commits.map(commit => <li key={commit.id}><button aria-pressed={selected === commit.id} onClick={() => setSelected(commit.id)}>
          <strong>{commit.subject || "(No subject)"}</strong>
          <span><code>{commit.shortId}</code> · {commit.author.name} · <time dateTime={commit.author.date} title={commit.author.date}>{formatDate(commit.author.date)}</time></span>
          {commit.references.length > 0 && <span className="labels">{commit.references.map(reference => <span className="ref-label" key={reference}>{reference.replace(/^refs\/(heads|remotes|tags)\//, "")}</span>)}</span>}
        </button></li>)}</ol>
        {history.hasNextPage && <button disabled={history.isFetching} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? "Loading more…" : "Load more commits"}</button>}
      </section>
      <ResizeHandle className="primary-resizer" axis="vertical" viewer={viewerRef} value={sizes.primary} initial={defaultLayout().sizes[mode].primary} label="Resize commit log" onChange={value => resize("primary", value)} />
      <ResizeHandle className="secondary-resizer" axis={mode === "columns" ? "vertical" : "horizontal"} viewer={viewerRef} offset={mode === "columns" ? sizes.primary : 0} value={sizes.secondary} initial={defaultLayout().sizes[mode].secondary} label={mode === "columns" ? "Resize files and diff" : "Resize upper panes and diff"} onChange={value => resize("secondary", value)} />
      {selected ? <CommitView key={selected} id={selected} diffMode={diffMode} onDiffModeChange={setDiffMode} filesMode={filesMode} onFilesModeChange={setFilesMode} /> : <>
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
