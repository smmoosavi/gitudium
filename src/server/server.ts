import { createAccessGuard, protectResponse } from "./access";
import { serveAsset, type EmbeddedAssets } from "./assets";
import { readLaunchOptions } from "./cli";
import { createRequestHandler } from "./http";

export interface ServerOptions {
  directory: string;
  port: number;
  development?: { origin: string; token?: string };
  assets?: EmbeddedAssets;
}

/** Owns the listener, repository discovery, monitor, and active event streams. */
export function createServer(options: ServerOptions) {
  const handleRequest = createRequestHandler(options.directory);
  const access = createAccessGuard(options.development?.token,
    options.development ? [options.development.origin] : undefined);
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: options.port,
      idleTimeout: 0,
      async fetch(request, server) {
        const rejected = access.protect(request, server.url.origin);
        if (rejected) return protectResponse(rejected, request);
        const pathname = new URL(request.url).pathname;
        const response = options.assets && pathname !== "/api" && !pathname.startsWith("/api/")
          ? serveAsset(request, options.assets)
          : await handleRequest(request);
        return protectResponse(response, request);
      },
    });
  } catch (error) {
    handleRequest.close();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    server,
    token: access.token,
    close(): Promise<void> {
      return closing ??= (async () => {
        try {
          handleRequest.close();
        } finally {
          await server.stop(true);
        }
      })();
    },
  };
}

export type StartupOptions =
  | { development: { origin: string; token?: string }; assets?: never }
  | { assets: EmbeddedAssets; development?: never };

/** CLI entrypoints own process signals; importing the factory has no process side effects. */
export function startServer(options: StartupOptions) {
  const launch = readLaunchOptions(Boolean(options.development));
  const instance = createServer({ ...launch, ...options });
  console.log(options.development
    ? `Gitudium development browser: ${options.development.origin}/#token=${instance.token}`
    : `Gitudium: ${instance.server.url}#token=${instance.token}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.off(signal, stop);
    void instance.close().then(() => process.exit(0), error => {
      console.error(error);
      process.exit(1);
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
}
