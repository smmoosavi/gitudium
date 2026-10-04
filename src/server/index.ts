import { handleRequest } from "./http";
import { createAccessGuard, protectResponse } from "./access";

const access = createAccessGuard(process.env.GITUDIUM_DEV_TOKEN, ["http://127.0.0.1:5173"]);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 3000,
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
