import assert from "node:assert/strict";
import { test } from "node:test";
import { fitHistory } from "../history.ts";
import type { ModelMessage } from "../ports.ts";

const tool = (id: string, size: number): ModelMessage => ({
  role: "tool",
  tool_call_id: id,
  name: "read_file",
  content: "x".repeat(size),
});

test("fitHistory cuts the oldest long tool outputs first, never the latest message", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "explain it" },
    tool("a", 10000),
    tool("b", 10000),
    tool("c", 10000),
  ];
  const fitted = fitHistory(messages, 22000);
  assert.deepEqual(
    fitted.map((m) => m.content.length < 10000),
    [true, true, false, false],
  );
  assert.match(fitted[1]?.content ?? "", /cut to fit/);
  assert.equal(messages[1]?.content.length, 10000); // the chat itself is untouched
  assert.deepEqual(fitHistory(messages, 100000), messages);
  // over budget even after every cut: the latest message stays whole
  assert.equal(fitHistory(messages, 10).at(-1)?.content.length, 10000);
});
