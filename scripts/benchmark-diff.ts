import { pairedDiffEngine } from "../src/client/diffEngine";
import { benchmarkCases } from "../tests/fixtures/diff-cases";
import type { DiffEngine } from "../src/client/diffModel";

const baselinePath = process.argv[2];
const baseline: DiffEngine | undefined = baselinePath ? (await import(new URL(baselinePath, `file://${process.cwd()}/`).href)).pairedDiffEngine : undefined;
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const measure = (engine: DiffEngine, patch: string) => {
  const start = performance.now();
  for (let iteration = 0; iteration < 20; iteration++) engine(patch);
  return (performance.now() - start) / 20;
};

for (const [name, patch] of Object.entries(benchmarkCases)) {
  if (baseline && JSON.stringify(baseline(patch)) !== JSON.stringify(pairedDiffEngine(patch))) throw new Error(`Output mismatch: ${name}`);
  for (let warmup = 0; warmup < 20; warmup++) { baseline?.(patch); pairedDiffEngine(patch); }
  const oldSamples: number[] = [];
  const newSamples: number[] = [];
  for (let sample = 0; sample < 9; sample++) {
    // Alternate measurement order to reduce warmup/drift bias.
    if (sample % 2 && baseline) oldSamples.push(measure(baseline, patch));
    newSamples.push(measure(pairedDiffEngine, patch));
    if (!(sample % 2) && baseline) oldSamples.push(measure(baseline, patch));
  }
  const current = median(newSamples);
  const old = baseline ? median(oldSamples) : undefined;
  console.log(JSON.stringify({ fixture: name, baselineMs: old, sharedMs: current, speedup: old === undefined ? undefined : old / current }));
}
