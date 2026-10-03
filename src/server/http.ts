import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";

export function handleRequest(request: Request): Promise<Response> | Response {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/trpc" || pathname.startsWith("/api/trpc/")) {
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: request,
      router: appRouter,
      createContext: () => ({}),
    });
  }
  return new Response("Not found", { status: 404 });
}
