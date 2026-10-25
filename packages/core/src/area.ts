import { BLOCKS, type BlockId, type Outcome, rungFor } from "@skarp/kernel";
import type { Area, LedgerEvent } from "@skarp/schema";

type Payload = Record<string, unknown>;

// What the skarp area shows, read from the ledger alone. The ledger is the truth;
// this only derives views from it, so it is never out of step after a restart.
export function buildArea(events: LedgerEvent[], stopped: boolean): Area {
  const p = (e: LedgerEvent) => e.payload as Payload;
  const asks = new Map(events.filter((e) => e.type === "ask").map((e) => [p(e).ask_id, p(e)]));
  const dismissed = new Set(events.filter((e) => e.type === "dismiss").map((e) => p(e).ref));
  const shelf: Area["shelf"] = [];

  // Not yet: a skipped or put-off question, until an X1 is answered later in that chat
  events.forEach((e, i) => {
    if (e.type !== "answer_skipped" && e.type !== "answer_not_yet") return;
    const ask = asks.get(p(e).ask_id);
    if (!ask || ask.intent === "commit" || dismissed.has(e.id)) return; // Commit comes back by itself
    const later = events.slice(i + 1).filter((l) => l.session_id === e.session_id);
    const answeredX1 = later.some(
      (l) => l.type === "answer" && asks.get(p(l).ask_id)?.block_id === "X1",
    );
    if (answeredX1) return;
    shelf.push({
      id: e.id,
      kind: "not-yet",
      title: String(ask.question_text),
      meta: `${e.type === "answer_skipped" ? "skipped" : "not yet"} · ${e.time.slice(0, 10)}`,
      session_id: e.session_id ?? "",
    });
  });

  // Not yet: a piece of an understand chat left, or missed twice
  for (const e of events) {
    if (e.type !== "piece_left" || dismissed.has(e.id)) continue;
    const why = { missed: "missed twice", not_yet: "not yet" }[String(p(e).reason)];
    shelf.push({
      id: e.id,
      kind: "not-yet",
      title: `Understand: ${String(p(e).piece)}`,
      meta: `${why ?? "not reached"} · ${e.time.slice(0, 10)}`,
      session_id: e.session_id ?? "",
    });
  }

  // Not answered: the model failed on a message, until a later reply in that chat
  events.forEach((e, i) => {
    if (e.type !== "error_model" || !p(e).owed || dismissed.has(e.id)) return;
    const answered = events
      .slice(i + 1)
      .some((l) => l.type === "assistant_reply" && l.session_id === e.session_id);
    if (answered) return;
    shelf.push({
      id: e.id,
      kind: "not-yet",
      title: `Not answered: ${String(p(e).owed).slice(0, 80)}`,
      meta: `model failed · ${e.time.slice(0, 10)}`,
      session_id: e.session_id ?? "",
    });
  });

  // Not run: a command you put off, until the same command runs
  events.forEach((e, i) => {
    if (e.type !== "run" || p(e).approved !== false || dismissed.has(e.id)) return;
    const ran = events
      .slice(i + 1)
      .some((l) => l.type === "run" && p(l).approved && p(l).command === p(e).command);
    if (ran) return;
    shelf.push({
      id: e.id,
      kind: "not-run",
      title: String(p(e).command),
      meta: `not run · ${e.time.slice(0, 10)}`,
      session_id: e.session_id ?? "",
    });
  });

  // Knowledge: one row per folder concept, recently touched first; no hits or misses shown
  const outcomes: Outcome[] = events
    .filter((e) => e.type === "outcome")
    .map((e) => ({ ...(p(e) as Omit<Outcome, "chat">), chat: e.session_id ?? "" }));
  const concepts = [...new Set(outcomes.map((o) => o.concept))];
  const knowledge: Area["knowledge"] = concepts.map((concept) => {
    const mine = outcomes.filter((o) => o.concept === concept && o.pass);
    const intents = new Set(mine.map((o) => BLOCKS[o.block as BlockId]?.intent));
    const depth: Area["knowledge"][number]["depth"] = intents.has("check")
      ? "applied"
      : intents.has("explain") || intents.has("hear")
        ? "explained"
        : undefined;
    return {
      concept,
      stage: (rungFor(concept, outcomes) + 1) as 1 | 2 | 3,
      ...(depth && { depth }),
      touched: outcomes.filter((o) => o.concept === concept).at(-1)?.day ?? "",
    };
  });
  knowledge.sort((a, b) => b.touched.localeCompare(a.touched));

  return { kind: "area", stopped, shelf, knowledge };
}
