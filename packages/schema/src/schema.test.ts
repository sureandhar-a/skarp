import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("schema parses and defines the core messages", () => {
  const s = JSON.parse(readFileSync(new URL("../messages.schema.json", import.meta.url), "utf8"));
  for (const k of [
    "UserMessage",
    "Answer",
    "Ask",
    "AssistantReply",
    "ErrorMessage",
    "InMessage",
    "OutMessage",
  ]) {
    assert.ok(s.definitions[k], `missing definition ${k}`);
  }
});
