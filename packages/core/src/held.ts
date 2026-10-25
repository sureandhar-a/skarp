// +/- line counts for the changes bar.
// limit: counts lines added or removed as multisets, not a real diff; a moved line counts 0.
export function diffStat(before: string, after: string): { add: number; del: number } {
  const counts = (text: string) => {
    const m = new Map<string, number>();
    for (const line of text === "" ? [] : text.split("\n")) m.set(line, (m.get(line) ?? 0) + 1);
    return m;
  };
  const a = counts(before);
  const b = counts(after);
  const extra = (x: Map<string, number>, y: Map<string, number>) =>
    [...x].reduce((n, [line, c]) => n + Math.max(0, c - (y.get(line) ?? 0)), 0);
  return { add: extra(b, a), del: extra(a, b) };
}
