import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/router";
import "./style.css";

const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
const queryClient = new QueryClient();

function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health.query({ name: "Gitudium" }),
    retry: false,
  });

  return (
    <main>
      <h1>Gitudium</h1>
      <p>A local, read-only Git history viewer.</p>
      <section aria-labelledby="connection-title">
        <h2 id="connection-title">Project foundation</h2>
        <p role="status">
          {health.isPending
            ? "Connecting to the local API…"
            : health.isError
              ? `Connection failed: ${health.error.message}`
              : health.data.message}
        </p>
        <button onClick={() => void health.refetch()} disabled={health.isFetching}>
          Check connection
        </button>
      </section>
      <p>Repository history will be added in the next milestones.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
