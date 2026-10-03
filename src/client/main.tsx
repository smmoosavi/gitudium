import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { HistoryCursor } from "../repository/types";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/router";
import "./style.css";

const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return <div role="alert"><p>{error.message}</p><button onClick={retry}>Retry</button></div>;
}

function CommitView({ id }: { id: string }) {
  const [path, setPath] = useState<string | null>(null);
  const commit = useQuery({ queryKey: ["commit", id], queryFn: ({ signal }) => api.commit.query({ revision: id }, { signal }), retry: false });
  const diff = useQuery({
    queryKey: ["diff", id, path], enabled: path !== null,
    queryFn: ({ signal }) => api.diff.query({ revision: id, path: path! }, { signal }), retry: false,
  });
  if (commit.isPending) return <p role="status">Loading commit…</p>;
  if (commit.isError) return <Failure error={commit.error} retry={() => void commit.refetch()} />;
  const details = commit.data;
  return <>
    <h2>{details.subject || "(No subject)"}</h2>
    <code className="object-id">{details.id}</code>
    <p>{details.author.name} &lt;{details.author.email}&gt; · <time dateTime={details.author.date}>{details.author.date}</time></p>
    <pre className="message">{details.message}</pre>
    <p className="muted">{details.parents.length > 1 ? "Merge: changes compared with the first parent." : details.diffBase ? "Changes compared with the parent commit." : "Root commit: changes compared with the empty tree."}</p>
    <h3>Changed files ({details.files.length})</h3>
    {!details.files.length && <p>No changed files.</p>}
    <ul className="files">{details.files.map(file => <li key={file.path}><button aria-pressed={path === file.path} onClick={() => setPath(file.path)}><span className="muted">{file.status}</span> <code>{file.path}</code></button></li>)}</ul>
    <h3>File diff{path !== null && <> · <code>{path}</code></>}</h3>
    {path === null ? <p>Select a changed file to load its diff.</p>
      : diff.isPending ? <p role="status">Loading diff…</p>
      : diff.isError ? <Failure error={diff.error} retry={() => void diff.refetch()} />
      : diff.data.state === "binary" ? <p role="status">Binary file: no text diff is available.</p>
      : diff.data.state === "oversized" ? <p role="status">Diff exceeds the {diff.data.limitBytes.toLocaleString()} byte limit.</p>
      : !diff.data.patch ? <p>No textual changes.</p>
      : <pre className="patch" aria-label="File diff"><code>{diff.data.patch.split("\n").map((line, index) => <span key={index} className={line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : line.startsWith("@@") ? "hunk" : undefined}>{line}{"\n"}</span>)}</code></pre>}
  </>;
}

function App() {
  const [revision, setRevision] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const metadata = useQuery({ queryKey: ["metadata"], queryFn: ({ signal }) => api.metadata.query(undefined, { signal }), retry: false });
  const references = useQuery({ queryKey: ["references"], enabled: metadata.isSuccess, queryFn: ({ signal }) => api.references.query(undefined, { signal }), retry: false });
  const history = useInfiniteQuery({
    queryKey: ["history", revision], enabled: metadata.isSuccess && references.isSuccess, initialPageParam: undefined as HistoryCursor | undefined,
    queryFn: ({ pageParam, signal }) => api.history.query({ revision: pageParam ? undefined : revision || undefined, limit: 50, cursor: pageParam }, { signal }),
    getNextPageParam: page => page.nextCursor ?? undefined, retry: false,
  });
  const commits = history.data?.pages.flatMap(page => page.commits) ?? [];
  return <main>
    <header><h1>Gitudium</h1><p>A local, read-only Git history viewer.</p></header>
    {metadata.isPending ? <p role="status">Loading repository…</p> : metadata.isError ? <Failure error={metadata.error} retry={() => void metadata.refetch()} /> : <p className="repository"><strong>{metadata.data.root ?? metadata.data.gitDirectory}</strong> · {metadata.data.branch ?? (metadata.data.head ? "Detached HEAD" : "No commits yet")}{metadata.data.bare && " · Bare repository"}</p>}
    <div className="viewer">
      <section aria-labelledby="history-title">
        <h2 id="history-title">History</h2>
        <label htmlFor="reference">Reference</label>{" "}
        <select id="reference" value={revision} onChange={event => { setRevision(event.target.value); setSelected(null); }}>
          <option value="">All references + HEAD</option>
          {references.data?.filter(ref => ref.commitId !== null).map(ref => <option key={ref.name} value={ref.name}>{ref.name}</option>)}
        </select>
        {references.isPending && <p role="status">Loading references…</p>}
        {references.isError && <Failure error={references.error} retry={() => void references.refetch()} />}
        <p className="muted">Topological order · 50 commits per page</p>
        {history.isPending && <p role="status">Loading history…</p>}
        {history.isError && <Failure error={history.error} retry={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())} />}
        {history.isSuccess && commits.length === 0 && <p>No commits in this history.</p>}
        <ol className="commits">{commits.map(commit => <li key={commit.id}><button aria-pressed={selected === commit.id} onClick={() => setSelected(commit.id)}>
          <strong>{commit.subject || "(No subject)"}</strong>
          <span><code>{commit.shortId}</code> · {commit.author.name} · <time dateTime={commit.author.date}>{commit.author.date}</time></span>
          {commit.references.length > 0 && <span className="labels">{commit.references.join(" · ")}</span>}
        </button></li>)}</ol>
        {history.hasNextPage && <button disabled={history.isFetching} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? "Loading more…" : "Load more commits"}</button>}
      </section>
      <section aria-label="Commit details">{selected ? <CommitView key={selected} id={selected} /> : <><h2>Commit details</h2><p>Select a commit to inspect its changed files and diffs.</p></>}</section>
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
