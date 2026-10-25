import assert from "node:assert/strict";
import { test } from "node:test";
import { conceptOf, matchConcept, type Outcome, rungFor } from "./fading.ts";

test("a concept is the folder, two levels deep", () => {
  assert.equal(conceptOf("src/auth/session/token.ts"), "src/auth");
  assert.equal(conceptOf("lib/x.ts"), "lib");
  assert.equal(conceptOf("README.md"), ".");
  assert.equal(matchConcept("fix the login in auth", ["src/auth", "src/billing"]), "src/auth");
  assert.equal(matchConcept("fix the src code", ["src/auth"]), undefined);
});

test("lighter after 2 chats on 2 days in 2 shapes; a miss drops a rung", () => {
  const o = (chat: string, day: string, block: string, pass = true): Outcome => ({
    concept: "src/auth",
    chat,
    day,
    block,
    pass,
  });
  assert.equal(rungFor("src/auth", []), 0);
  // same day or same block is not enough
  assert.equal(rungFor("src/auth", [o("a", "d1", "A1"), o("b", "d1", "LS-B6")]), 0);
  assert.equal(rungFor("src/auth", [o("a", "d1", "A1"), o("b", "d2", "A1")]), 0);

  const one = [o("a", "d1", "A1"), o("b", "d2", "LS-B6")];
  assert.equal(rungFor("src/auth", one), 1);
  const two = [...one, o("c", "d3", "A1"), o("d", "d4", "R2")];
  assert.equal(rungFor("src/auth", two), 2);
  assert.equal(rungFor("src/auth", [...two, o("e", "d5", "K8", false)]), 1);
  assert.equal(rungFor("src/billing", two), 0);
});
