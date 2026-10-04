import { randomBytes } from "node:crypto";

const token = randomBytes(32).toString("hex");
const children = [
  Bun.spawn(["bun", "run", "dev:server"], { stdout: "inherit", stderr: "inherit", env: { ...process.env, GITUDIUM_DEV_TOKEN: token } }),
  Bun.spawn(["bun", "run", "dev:client"], { stdout: "inherit", stderr: "inherit" }),
];

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, stop);
}

const firstExit = await Promise.race(children.map((child) => child.exited));
stop();
await Promise.all(children.map((child) => child.exited));
process.exitCode = firstExit;
