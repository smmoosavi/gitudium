import type { DiffEngine } from "./diffModel";
import { diffModelFromBlocks } from "./diffEngine";
import { createTextChangePolicy, patchChangeBlocks } from "./wordDiff";
import { createLineAligner } from "./lineAlignment";
import { createSyntaxMatcher, type MatchResult, type MatchToken } from "./syntaxMatcher";

function scopeAwarePatch(patch: string, syntax: MatchResult): string {
  const lines = patch.split("\n");
  if (lines.some(line => line.startsWith("\\ No newline"))) return patch;
  let old = 0;
  let next = 0;
  let inHunk = false;
  const output: string[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => { output.push(...removed, ...added); removed = []; added = []; };
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { flush(); old = Number(hunk[1]) - 1; next = Number(hunk[2]) - 1; inHunk = true; output.push(line); continue; }
    if (inHunk && line.startsWith(" ")) {
      const before = syntax.before?.[old++];
      const after = syntax.after?.[next++];
      const scopes = (tokens: MatchToken[]) => tokens.filter(token => token.type).map(token => token.scope);
      // Git can anchor an identical closing brace to a completely different object.
      if (before && after && before.map(token => token.text).join("") === line.slice(1) && after.map(token => token.text).join("") === line.slice(1)
        && [...before, ...after].some(token => token.scope !== undefined) && JSON.stringify(scopes(before)) !== JSON.stringify(scopes(after))) {
        removed.push("-" + line.slice(1)); added.push("+" + line.slice(1)); continue;
      }
    } else if (inHunk && line.startsWith("-")) { old++; removed.push(line); continue; }
    else if (inHunk && line.startsWith("+")) { next++; added.push(line); continue; }
    else inHunk = false;
    flush(); output.push(line);
  }
  flush();
  return output.join("\n");
}

/** Syntax-specific repair, token mapping and textual fallbacks stay behind DiffEngine. */
export function createSyntaxDiffEngine(syntax: MatchResult): DiffEngine {
  return patch => {
    patch = scopeAwarePatch(patch, syntax);
    const textual = createTextChangePolicy(createLineAligner());
    const matcher = createSyntaxMatcher();
    const tokens = new Map<number, MatchToken[]>();
    let old = 0;
    let next = 0;
    let inHunk = false;
    for (const [index, line] of patch.split("\n").entries()) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) { old = Number(hunk[1]) - 1; next = Number(hunk[2]) - 1; inHunk = true; continue; }
      if (!inHunk) continue;
      const source = line.startsWith("-") ? syntax.before?.[old++] : line.startsWith("+") ? syntax.after?.[next++] : undefined;
      if (line.startsWith(" ")) { old++; next++; }
      else if (!line.startsWith("-") && !line.startsWith("+") && !line.startsWith("\\ No newline")) inHunk = false;
      if (source && source.map(token => token.text).join("") === line.slice(1)) tokens.set(index, source);
    }
    const blocks = patchChangeBlocks(patch, {
      align: (removed, added, before, after) => {
        const fallback = () => textual.align(removed, added, before, after);
        if (![...removed, ...added].every(index => tokens.has(index))) return fallback();
        return matcher.align(before, after, removed.map(index => tokens.get(index)!), added.map(index => tokens.get(index)!), fallback);
      },
      highlightBlock: (removed, added) => {
        if (!removed.length || !added.length || Math.max(removed.length, added.length) > 100 || ![...removed, ...added].every(index => tokens.has(index))) return;
        const result = matcher.highlightBlock(removed.map(index => tokens.get(index)!), added.map(index => tokens.get(index)!));
        if (!result) return;
        return new Map([...removed.map((index, row) => [index, result.before[row]!] as const), ...added.map((index, row) => [index, result.after[row]!] as const)]);
      },
      highlight: (oldIndex, newIndex, beforeText, afterText) => {
        const before = tokens.get(oldIndex);
        const after = tokens.get(newIndex);
        return (before && after ? matcher.highlight(before, after) : undefined)
          ?? textual.highlight(oldIndex, newIndex, beforeText, afterText);
      },
    });
    return diffModelFromBlocks(patch, blocks);
  };
}
