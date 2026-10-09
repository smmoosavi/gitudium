import { defaultDiffEngine } from "./diffEngine";

export type DiffSegment = { text: string; changed: boolean; color?: string };
export type DiffLine = { text: string; number?: number; kind: "context" | "addition" | "deletion"; noNewline?: boolean; segments?: DiffSegment[] };
export type DiffContextGap = { id: string; count: number };
export type DiffRow = { header: string } | { gap: DiffContextGap } | { left?: DiffLine; right?: DiffLine };
export type UnifiedDiffLine = { text: string; oldNumber?: number; newNumber?: number; prefix?: string; kind?: "addition" | "deletion" | "hunk"; segments?: DiffSegment[]; gap?: DiffContextGap };

/** Plain render data: segment text concatenates to line text; undefined segments mean whole-line fallback. */
export interface DiffModel {
  unified: UnifiedDiffLine[];
  split: DiffRow[];
}

/** Engines own parsing, pairing and highlighting, and must preserve source text and row order. */
export type DiffEngine = (patch: string) => DiffModel;

export function buildDiffModel(patch: string, engine: DiffEngine = defaultDiffEngine): DiffModel {
  return engine(patch);
}
