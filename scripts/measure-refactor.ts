import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepositoryReader } from "../src/repository/git";
import type { CommitSummary } from "../src/repository/types";
import { layoutCommitGraph } from "../src/client/graph";

const directory = await mkdtemp(join(tmpdir(), "gitudium-measure-"));
const env = {
  ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Measurement", GIT_AUTHOR_EMAIL: "measurement@example.test",
  GIT_COMMITTER_NAME: "Measurement", GIT_COMMITTER_EMAIL: "measurement@example.test",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};
async function git(...args: string[]) {
  const child = Bun.spawn(["git", "--no-pager", ...args], { cwd: directory, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (status) throw new Error(stderr);
  return stdout.trim();
}
async function measure<T>(run: () => T | Promise<T>) {
  const start = performance.now();
  const result = await run();
  return { result, ms: performance.now() - start };
}
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { minMs: +sorted[0]!.toFixed(3), medianMs: +sorted[Math.floor(sorted.length / 2)]!.toFixed(3), maxMs: +sorted.at(-1)!.toFixed(3) };
}

try {
  console.log(JSON.stringify({ runtime: Bun.version, git: await git("--version"), samples: 7, historyLimit: 200 }));
  await git("init", "-b", "main");
  const tree = await git("mktree");
  const ids: string[] = [];
  for (let i = 0; i < 600; i++) ids.push(await git("commit-tree", tree, ...(i ? ["-p", ids[i - 1]!] : []), "-m", `linear ${i}`));
  await git("update-ref", "refs/heads/main", ids.at(-1)!);
  let installed = 0;
  for (const refs of [32, 160, 512]) {
    for (; installed < refs; installed++) {
      const id = await git("commit-tree", tree, "-p", ids.at(-1)!, "-m", `tip ${installed}`);
      await git("update-ref", `refs/custom/tip-${installed}`, id);
    }
    const initial: number[] = [], repeated: number[] = [], subsequent: number[] = [];
    for (let sample = 0; sample < 7; sample++) {
      const reader = await GitRepositoryReader.discover(directory);
      const first = await measure(() => reader.history({ limit: 200 }));
      if (first.result.commits.length !== 200 || !first.result.nextCursor) throw new Error("Incomplete measurement fixture");
      initial.push(first.ms);
      repeated.push((await measure(() => reader.history({ limit: 200 }))).ms);
      const second = await measure(() => reader.history({ limit: 200, cursor: first.result.nextCursor! }));
      if (second.result.commits.length !== 200) throw new Error("Incomplete subsequent page");
      subsequent.push(second.ms);
    }
    console.log(JSON.stringify({ kind: "history-reader", commits: 600 + refs, customRefs: refs, initial: stats(initial), repeated: stats(repeated), subsequent: stats(subsequent) }));
  }
  for (const size of [200, 1000, 5000]) {
    for (const topology of ["linear", "branching"] as const) {
      const commits: CommitSummary[] = Array.from({ length: size }, (_, index) => ({
        id: `graph-${index}`, shortId: `${index}`, subject: `commit ${index}`,
        parents: index + 1 < size ? [`graph-${index + 1}`, ...(topology === "branching" && index % 10 === 0 && index + 5 < size ? [`graph-${index + 5}`] : [])] : [],
        author: { name: "Measurement", email: "measurement@example.test", date: "2026-01-01T00:00:00Z" },
        references: index === 0 ? ["refs/heads/main"] : topology === "branching" && index % 10 === 1 ? [`refs/heads/feature-${index}`] : [],
      }));
      layoutCommitGraph(commits);
      const full: number[] = [], append: number[] = [];
      for (let sample = 0; sample < 7; sample++) {
        const previous = layoutCommitGraph(commits.slice(0, Math.floor(size / 2)));
        const result = await measure(() => layoutCommitGraph(commits));
        if (result.result.rows.length !== size) throw new Error("Incomplete graph");
        full.push(result.ms);
        append.push((await measure(() => layoutCommitGraph(commits, null, previous))).ms);
      }
      console.log(JSON.stringify({ kind: "graph", topology, commits: size, full: stats(full), append: stats(append) }));
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
