import assert from "node:assert/strict";
import { test } from "node:test";
import { brainstormFixes, brainstormSummary, highStakes, parseMap } from "./modes.ts";

const map = (...lines: string[]) => `### skarp map\n${lines.map((l) => `- ${l}`).join("\n")}`;

test("parseMap reads ideas, arguments, verdicts, questions and open items", () => {
  const events = parseMap(
    `text\n${map(
      "idea I2 (ai): cache per user",
      "against I1: two callers bypass it [evidence: src/api.ts:40]",
      "verdict I1: risky, the callers bypass it [evidence: src/api.ts:40]",
      'question failure: "it only runs once a day"',
      "open: how big is the table?",
    )}`,
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ["idea", "arg", "verdict", "question", "open"],
  );
  assert.equal(events[0]?.by, "ai");
  assert.equal(events[1]?.evidence, "src/api.ts:40");
  assert.equal(events[2]?.verdict, "risky");
  assert.equal(events[3]?.category, "failure");
});

test("you first: AI options before the user's idea are sent back, unless the user unlocked them", () => {
  const reply = `Some options:\n1. Redis\n2. Postgres\n${map("idea I1 (ai): Redis")}`;
  assert.equal(brainstormFixes(reply, "you-first", [], false, false).length, 1);
  assert.deepEqual(brainstormFixes(reply, "you-first", [], false, true), []);
});

test("listing: no verdicts while the user lists", () => {
  const reply = `Noted.\n${map("verdict I1: risky, slow")}`;
  assert.match(brainstormFixes(reply, "listing", [], false, false).join(), /still listing/);
});

test("stress: a verdict needs a Restated line; questions quote the user, at most two", () => {
  const said = ["Move the queue to Redis, it only runs once a day"];
  const good = `Restated: Would moving the queue to Redis remove the waits?\n### Question\nYou said "it only runs once a day": what happens at peak?\n${map("verdict I1: unknown, no load data")}`;
  assert.deepEqual(brainstormFixes(good, "stress", said, false, false), []);
  const bad = `### Question\nWhat about "a totally invented quote"? And x? And y?\n${map("verdict I1: risky, slow")}`;
  const fixes = brainstormFixes(bad, "stress", said, false, false).join("\n");
  assert.match(fixes, /Restated/);
  assert.match(fixes, /at most 2/);
  assert.match(fixes, /quote the user's exact words/);
});

test("agreement without evidence is flagged; with a file it is not", () => {
  const said = ["use a cache"];
  const q = '### Question\n"use a cache": for which calls?\n';
  assert.match(
    brainstormFixes(
      `Great idea, that works.\n${q}${map("open: size")}`,
      "stress",
      said,
      false,
      false,
    ).join(),
    /without evidence/,
  );
  assert.doesNotMatch(
    brainstormFixes(
      `Great, src/cache.ts already has an LRU.\n${q}${map("open: size")}`,
      "stress",
      said,
      false,
      false,
    ).join(),
    /without evidence/,
  );
});

test("decide on hard-to-undo work needs a pre-mortem", () => {
  assert.ok(highStakes("change the users table schema"));
  assert.equal(brainstormFixes("Which one?", "decide", [], true, false).length, 1);
  assert.deepEqual(brainstormFixes("### Pre-mortem\nx\nWhich one?", "decide", [], true, false), []);
});

test("the summary keeps who raised what, the decision in the user's words, and coverage", () => {
  const sum = brainstormSummary("caching", [
    { type: "idea", idea: "I1", by: "you", text: "cache per user" },
    { type: "idea", idea: "I2", by: "ai", text: "no cache, fix the query" },
    { type: "verdict", idea: "I1", verdict: "risky", text: "stale data", evidence: "src/a.ts:3" },
    { type: "question", category: "failure", text: "x" },
    { type: "open", text: "how stale is ok?" },
    { kind: "decision", chosen: "fix the query", why: "because the cache hides the bug", text: "" },
  ] as never);
  assert.match(sum.md, /\*\*I1\*\* \(you\)/);
  assert.match(sum.md, /\*\*I2\*\* \(AI\)/);
  assert.match(sum.md, /Why \(your words\):\*\* because the cache hides the bug/);
  assert.match(sum.md, /covered 1 of 8/);
  assert.equal(sum.byYou, 1);
  assert.equal(sum.byAi, 1);
});
