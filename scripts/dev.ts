import { randomBytes } from "node:crypto";
import { readLaunchOptions } from "../src/server/cli";

const options = readLaunchOptions(true);
const env = { ...process.env, GITUDIUM_PORT: String(options.port), GITUDIUM_DIRECTORY: options.directory };
const token = randomBytes(32).toString("hex");
const children = [
  Bun.spawn(["bun", "run", "dev:server"], { stdout: "inherit", stderr: "inherit", env: { ...env, GITUDIUM_DEV_TOKEN: token } }),
  Bun.spawn(["bun", "run", "dev:client"], { stdout: "inherit", stderr: "inherit", env }),
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
