import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { token } from "./api";
import "./style.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {token ? <App /> : <main><h1>Gitudium</h1><p role="alert">Access token missing or invalid. Open the full URL printed by Gitudium in this tab.</p></main>}
    </QueryClientProvider>
  </StrictMode>,
);
