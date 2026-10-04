import { StrictMode, useEffect, useRef, useState } from "react";
import { createLiveRefresh } from "./live";
import { connectEvents, loadAccessToken } from "./access";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { HistoryCursor } from "../repository/types";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/router";
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

function CommitView({ id }: { id: string }) {
  const [path, setPath] = useState<string | null>(null);
  const commit = useQuery({ queryKey: ["commit", id], staleTime: Infinity, queryFn: ({ signal }) => api.commit.query({ revision: id }, { signal }), retry: false });
  const diff = useQuery({
    queryKey: ["diff", id, path], enabled: path !== null, staleTime: Infinity,
    queryFn: ({ signal }) => api.diff.query({ revision: id, path: path! }, { signal }), retry: false,
  });
  if (commit.isPending) return <p role="status">Loading commit…</p>;
  if (commit.isError) return <Failure error={commit.error} retry={() => void commit.refetch()} />;
  const details = commit.data;
  return <>
    <div className="panel-heading"><h2>Commit details</h2><code>{details.shortId}</code></div>
    <div className="commit-summary">
    <h3>{details.subject || "(No subject)"}</h3>
    <code className="object-id">{details.id}</code>
    <p>{details.author.name} &lt;{details.author.email}&gt; · <time dateTime={details.author.date} title={details.author.date}>{formatDate(details.author.date)}</time></p>
    <pre className="message">{details.message}</pre>
    <p className="muted">{details.parents.length > 1 ? "Merge: changes compared with the first parent." : details.diffBase ? "Changes compared with the parent commit." : "Root commit: changes compared with the empty tree."}</p>
    </div>
    <div className="panel-heading"><h3>Changed files</h3><span className="count">{details.files.length}</span></div>
    {!details.files.length && <p className="empty-hint">No changed files.</p>}
    <ul className="files">{details.files.map(file => <li key={file.path}><button aria-pressed={path === file.path} onClick={() => setPath(file.path)}><span className={`file-status ${file.status}`} title={file.status}>{file.status === "type-changed" ? "T" : file.status.charAt(0).toUpperCase()}</span><code>{file.path}</code><span className="file-kind">{file.status}</span></button></li>)}</ul>
    <div className="panel-heading diff-heading"><h3>File diff{path !== null && <> · <code>{path}</code></>}</h3><span className="muted">Unified</span></div>
    <div className="diff-content">
    {path === null ? <p>Select a changed file to load its diff.</p>
      : diff.isPending ? <p role="status">Loading diff…</p>
      : diff.isError ? <Failure error={diff.error} retry={() => void diff.refetch()} />
      : diff.data.state === "binary" ? <p role="status">Binary file: no text diff is available.</p>
      : diff.data.state === "oversized" ? <p role="status">Diff exceeds the {diff.data.limitBytes.toLocaleString()} byte limit.</p>
      : !diff.data.patch ? <p>No textual changes.</p>
      : <pre className="patch" aria-label="File diff"><code>{diff.data.patch.split("\n").map((line, index) => <span key={index} className={line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : line.startsWith("@@") ? "hunk" : undefined}>{line || " "}</span>)}</code></pre>}
    </div>
  </>;
}

function App() {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [logWidth, setLogWidth] = useState(42);
  const [resizing, setResizing] = useState(false);
  const resizeLog = (width: number) => setLogWidth(Math.max(25, Math.min(70, width)));
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
    <div className="workspace-bar"><span className="workspace-tab">Git</span><span className="workspace-caption">Repository history</span></div>
    <div className="repository-bar">
    {metadata.isPending ? <p role="status">Loading repository…</p> : metadata.isError ? <Failure error={metadata.error} retry={() => void metadata.refetch()} /> : <p className="repository"><strong title={repositoryPath}>{repositoryPath}</strong><span className="branch-label">⑂ {metadata.data.branch ?? (metadata.data.head ? "Detached HEAD" : "No commits yet")}</span>{metadata.data.bare && <span className="muted">Bare repository</span>}</p>}
    </div>
    <div ref={viewerRef} className={`viewer${resizing ? " resizing" : ""}`} style={{ gridTemplateColumns: `minmax(240px, ${logWidth}fr) 6px minmax(240px, ${100 - logWidth}fr)` }}>
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
      <div className="column-resizer" role="separator" aria-label="Resize commit log" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={70} aria-valuenow={Math.round(logWidth)} aria-controls="history-title" tabIndex={0}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = viewerRef.current?.getBoundingClientRect();
          if (bounds) resizeLog((event.clientX - bounds.left - 3) / (bounds.width - 6) * 100);
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          setResizing(false);
        }}
        onPointerCancel={() => setResizing(false)}
        onLostPointerCapture={() => setResizing(false)}
        onDoubleClick={() => resizeLog(42)}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          resizeLog(event.key === "Home" ? 25 : event.key === "End" ? 70 : logWidth + (event.key === "ArrowLeft" ? -2 : 2));
        }}
      />
      <section className="details-panel" aria-label="Commit details">{selected ? <CommitView key={selected} id={selected} /> : <><div className="panel-heading"><h2>Commit details</h2></div><div className="empty-state"><span className="empty-icon" aria-hidden="true">⑂</span><h3>Explore your repository</h3><p>Select a commit from the log to inspect its<br />changed files and diffs.</p><span className="empty-note">Local repository · Read-only access</span></div></>}</section>
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
