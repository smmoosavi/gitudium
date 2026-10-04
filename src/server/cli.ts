import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { version } from "../../package.json";

export interface LaunchOptions {
  port: number;
  directory: string;
}

export const help = `Usage: gitudium [options] [directory]

Browse a local Git repository (defaults to the current directory).

Options:
  -h, --help                 Show this help and exit
  -v, --version              Show the version and exit
  -p, --port <port>          Listen on port 0–65535 (0 chooses a free port)
  -d, --directory <path>     Repository directory (or use the positional argument)

Environment:
  GITUDIUM_PORT              Port (default: 9171; development: 3000)
  GITUDIUM_DIRECTORY         Repository directory (default: current directory)

Command-line options override environment variables. The server binds only to
127.0.0.1. Development uses a fixed browser port of 5173 and requires a nonzero
backend port. Use -- before directory names beginning with a dash.
`;

export function parseLaunchOptions(
  args: string[],
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
  development = false,
): LaunchOptions | "help" | "version" {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      port: { type: "string", short: "p" },
      directory: { type: "string", short: "d" },
    },
  });
  if (values.help) return "help";
  if (values.version) return "version";
  if (positionals.length > 1) throw new Error("Expected at most one repository directory");
  if (values.directory !== undefined && positionals.length) {
    throw new Error("Use either --directory or a positional directory, not both");
  }
  const rawPort = values.port ?? env.GITUDIUM_PORT ?? (development ? "3000" : "9171");
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(Number(rawPort)) || Number(rawPort) > 65535) {
    throw new Error("Port must be an integer between 0 and 65535");
  }
  const port = Number(rawPort);
  if (development && port === 0) throw new Error("Development requires a nonzero backend port");
  const rawDirectory = values.directory ?? positionals[0] ?? env.GITUDIUM_DIRECTORY ?? cwd;
  if (!rawDirectory) throw new Error("Repository directory must not be empty");
  return { port, directory: resolve(cwd, rawDirectory) };
}

export function readLaunchOptions(development = false): LaunchOptions {
  try {
    const options = parseLaunchOptions(process.argv.slice(2), process.env, process.cwd(), development);
    if (options === "help" || options === "version") {
      console.log(options === "help" ? help : version);
      process.exit(0);
    }
    if (!statSync(options.directory).isDirectory()) throw new Error("Repository path is not a directory");
    return options;
  } catch (error) {
    console.error(`Gitudium: ${error instanceof Error ? error.message : String(error)}\nRun with --help for usage.`);
    process.exit(1);
  }
}
