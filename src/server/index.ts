import { createRequestHandler } from "./http";
import { createAccessGuard, protectResponse } from "./access";
import { readLaunchOptions } from "./cli";

const options = readLaunchOptions(true);
const handleRequest = createRequestHandler(options.directory);
const access = createAccessGuard(process.env.GITUDIUM_DEV_TOKEN, ["http://127.0.0.1:5173"]);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: options.port,
  idleTimeout: 0,
  async fetch(request, server) {
    const rejected = access.protect(request, server.url.origin);
    return protectResponse(rejected ?? await handleRequest(request), request);
  },
});

console.log(`Gitudium development browser: http://127.0.0.1:5173/#token=${access.token}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    handleRequest.close();
    server.stop(true);
    process.exit(0);
  });
}
