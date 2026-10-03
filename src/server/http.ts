import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { GitRepositoryReader } from "../repository/git";
import type { RepositoryReader } from "../repository/types";

export function createRequestHandler(cwd = process.cwd(), suppliedReader?: RepositoryReader) {
  let repository: Promise<RepositoryReader> | undefined;
  const reader = () => repository ??= suppliedReader ? Promise.resolve(suppliedReader) : GitRepositoryReader.discover(cwd);
  return function handleRequest(request: Request): Promise<Response> | Response {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/trpc" || pathname.startsWith("/api/trpc/")) {
      return fetchRequestHandler({
        endpoint: "/api/trpc",
        req: request,
        router: appRouter,
        createContext: () => ({ reader }),
      });
    }
    return new Response("Not found", { status: 404 });
  };
}

export const handleRequest = createRequestHandler();
