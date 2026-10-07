import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { GitRepositoryReader } from "../repository/git";
import type { RepositoryReader } from "../repository/types";
import { RepositoryMonitor, type RepositoryInvalidation, type RepositoryMonitorOptions } from "../repository/monitor";

export function createRequestHandler(cwd = process.cwd(), suppliedReader?: RepositoryReader, monitorOptions: RepositoryMonitorOptions = {}) {
  let repository: Promise<RepositoryReader> | undefined;
  const shutdown = new AbortController();
  const reader = () => repository ??= (suppliedReader ? Promise.resolve(suppliedReader) : GitRepositoryReader.discover(cwd, shutdown.signal)).catch(error => {
    repository = undefined;
    throw error;
  });
  const monitor = new RepositoryMonitor(reader, monitorOptions);
  const encoder = new TextEncoder();
  async function events(request: Request): Promise<Response> {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    try {
      await monitor.start();
    } catch {
      return new Response("Repository events unavailable", { status: 503 });
    }
    let cleanup = () => {};
    let flush = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let unsubscribe = () => {};
        let ended = false;
        let pending: RepositoryInvalidation | undefined;
        flush = () => {
          if (ended || !pending || (controller.desiredSize ?? 0) <= 0) return;
          const event = pending;
          pending = undefined;
          controller.enqueue(encoder.encode(`event: invalidation\ndata: ${JSON.stringify(event)}\n\n`));
        };
        const finish = () => {
          if (ended) return;
          cleanup();
          controller.close();
        };
        cleanup = () => {
          if (ended) return;
          ended = true;
          pending = undefined;
          flush = () => {};
          unsubscribe();
          request.signal.removeEventListener("abort", finish);
        };
        request.signal.addEventListener("abort", finish, { once: true });
        if (request.signal.aborted || shutdown.signal.aborted) {
          finish();
          return;
        }
        unsubscribe = monitor.subscribe(event => {
          if (event === null) finish();
          else if (!ended) {
            // Keep only the latest change beyond the single queued event.
            pending = event;
            flush();
          }
        });
      },
      pull() { flush(); },
      cancel() { cleanup(); },
    });
    return new Response(body, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    } });
  }
  function handleRequest(request: Request): Promise<Response> | Response {
    if (shutdown.signal.aborted) return new Response("Server closed", { status: 503 });
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/events") return events(request);
    if (pathname === "/api/trpc" || pathname.startsWith("/api/trpc/")) {
      return fetchRequestHandler({
        endpoint: "/api/trpc",
        req: request,
        router: appRouter,
        createContext: () => ({ reader }),
      });
    }
    return new Response("Not found", { status: 404 });
  }
  return Object.assign(handleRequest, {
    close() {
      shutdown.abort();
      monitor.close();
    },
  });
}

export const handleRequest = createRequestHandler();
