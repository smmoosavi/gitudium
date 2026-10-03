import { handleRequest } from "./http";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 3000,
  idleTimeout: 0,
  fetch: handleRequest,
});

console.log(`Gitudium development API: ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    handleRequest.close();
    server.stop(true);
    process.exit(0);
  });
}
