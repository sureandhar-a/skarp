// Fading: asks get lighter per concept: full ask -> one-tap confirm -> silence.
import { tokens } from "./gap.ts";

export type Rung = 0 | 1 | 2; // 0 full ask, 1 one-tap confirm, 2 silence

export interface Outcome {
  concept: string;
  chat: string; // session id
  day: string; // YYYY-MM-DD
  block: string; // block id, so "a new shape" can be counted
  pass: boolean; // passed the Referee or the gap; a miss otherwise
}

// a concept is anchored to a folder. limit: the first two folder levels; a model-picked label later.
export function conceptOf(path: string): string {
  const dirs = path.split("/").slice(0, -1);
  return dirs.slice(0, 2).join("/") || ".";
}

// The known concept your message names most, if any (used before the AI has touched anything).
export function matchConcept(text: string, concepts: string[]): string | undefined {
  const words = new Set(tokens(text));
  let best: string | undefined;
  let bestHits = 0;
  for (const c of concepts) {
    const hits = tokens(c).filter((w) => words.has(w) && w !== "src").length;
    if (hits > bestHits) [best, bestHits] = [c, hits];
  }
  return best;
}

// one rung lighter after passes in 2 chats on 2 different days with 2 different blocks;
// a miss drops one rung. Outcomes are in ledger order.
export function rungFor(concept: string, outcomes: Outcome[]): Rung {
  let rung = 0;
  let passes: Outcome[] = [];
  for (const o of outcomes) {
    if (o.concept !== concept) continue;
    if (!o.pass) {
      rung = Math.max(0, rung - 1);
      passes = [];
      continue;
    }
    passes.push(o);
    const distinct = (key: keyof Outcome) => new Set(passes.map((p) => p[key])).size;
    if (distinct("chat") >= 2 && distinct("day") >= 2 && distinct("block") >= 2) {
      rung = Math.min(2, rung + 1);
      passes = [];
    }
  }
  return rung as Rung;
}
