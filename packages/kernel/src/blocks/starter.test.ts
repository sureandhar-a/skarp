import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKS } from "./starter.ts";

test("every starter block has its fields, and only deep blocks are opt-in", () => {
  assert.equal(Object.keys(BLOCKS).length, 20); // 14 starters + O1, O2, UC1 + R21, read-back, X4
  for (const [id, b] of Object.entries(BLOCKS)) {
    assert.equal(b.id, id);
    assert(b.brief && b.question_text, id);
    assert.equal(b.opt_in === true, b.cost === "deep", id);
  }
});
