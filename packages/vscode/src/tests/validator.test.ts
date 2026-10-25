import assert from "node:assert/strict";
import { test } from "node:test";
import type { UserMessage } from "@skarp/schema";
import { ValidateAndParse } from "../validator.ts";

const session_id = "1234-random-id";

test("Shape doesn't exist in schema", async () => {
  const shape = JSON.stringify({ name: "hacker", command: "ls" });
  const val = ValidateAndParse(shape, session_id);
  assert.equal(val, null, "Validate and parse if not working");
});

test("UserMessage Shape exist in schema", async () => {
  const shape = {
    kind: "user_message",
    text: "Hi",
    session_id: session_id,
  } as UserMessage;
  const val = ValidateAndParse(shape, session_id);
  assert(val?.kind === "user_message", "Validate and parse if not working");
});

test('user_message with text " "', () => {
  const raw = { kind: "user_message", text: " " };
  const val = ValidateAndParse(raw, session_id);
  assert.equal(val, null);
});

test("user_message with no text", () => {
  const raw = { kind: "user_message" };
  const val = ValidateAndParse(raw, session_id);
  assert.equal(val, null);
});

test("answer missing nonce", () => {
  const raw = { kind: "answer", ask_id: "ask-123", response: "answered", value: "ok" };
  const val = ValidateAndParse(raw, session_id);
  assert.equal(val, null);
});

test("answer with value: 5", () => {
  const raw = {
    kind: "answer",
    ask_id: "ask-123",
    nonce: "nonce-123",
    response: "answered",
    value: 5,
  };
  const val = ValidateAndParse(raw, session_id);
  assert.equal(val, null);
});

test("Old nested answer shape (ask: { ask_id, nonce })", () => {
  const raw = {
    kind: "answer",
    ask: { ask_id: "ask-123", nonce: "nonce-123" },
    response: "answered",
    value: "ok",
  };
  const val = ValidateAndParse(raw, session_id);
  assert.equal(val, null);
});

test('null, "x", and { kind: "ask" }', () => {
  assert.equal(ValidateAndParse(null, session_id), null);
  assert.equal(ValidateAndParse("x", session_id), null);
  assert.equal(ValidateAndParse({ kind: "ask" }, session_id), null);
});

test('user_message carrying session_id: "evil"', () => {
  const raw = { kind: "user_message", text: "hello", session_id: "evil" };
  const val = ValidateAndParse(raw, session_id);
  assert.notEqual(val, null);
  assert.equal(val?.kind, "user_message");
  if (val?.kind === "user_message") {
    assert.equal(val.session_id, session_id);
    assert.notEqual(val.session_id, "evil");
  }
});

const answer = { kind: "answer", ask_id: "ask-123", nonce: "nonce-123" };

test("answer: typed, skipped and not_yet pass", () => {
  for (const [response, value] of [
    ["answered", "ok"],
    ["skipped", ""],
    ["not_yet", ""],
  ]) {
    const val = ValidateAndParse({ ...answer, response, value }, session_id);
    assert.equal(val?.kind === "answer" && val.response, response);
  }
});

test("answer: rejected response shapes", () => {
  for (const raw of [
    { ...answer, value: "ok" }, // missing response
    { ...answer, response: "skip", value: "" }, // not in the enum
    { ...answer, response: 5, value: "ok" }, // wrong type
    { ...answer, response: "answered", value: " " }, // typed but blank
    { ...answer, response: "skipped", value: "skip" }, // a click carrying text
  ]) {
    assert.equal(ValidateAndParse(raw, session_id), null, JSON.stringify(raw));
  }
});

test("edit_decision: session from the extension, only known actions, extra fields dropped", () => {
  assert.deepEqual(
    ValidateAndParse(
      { kind: "edit_decision", action: "accept", path: "src/a.ts", session_id: "forged", x: 1 },
      session_id,
    ),
    { kind: "edit_decision", session_id, action: "accept", path: "src/a.ts" },
  );
  assert.deepEqual(ValidateAndParse({ kind: "edit_decision", action: "reject" }, session_id), {
    kind: "edit_decision",
    session_id,
    action: "reject",
  });
  assert.equal(ValidateAndParse({ kind: "edit_decision", action: "write" }, session_id), null);
});

test("chat switching: plain ids only; finish gets the current chat", () => {
  assert.deepEqual(ValidateAndParse({ kind: "open_session", session_id: "abc-1" }, session_id), {
    kind: "open_session",
    session_id: "abc-1",
  });
  assert.equal(ValidateAndParse({ kind: "delete_session", session_id: "../x" }, session_id), null);
  assert.deepEqual(ValidateAndParse({ kind: "finish", session_id: "other" }, session_id), {
    kind: "finish",
    session_id,
  });
  assert.equal(
    ValidateAndParse({ kind: "run_decision", run_id: "r", nonce: "n" }, session_id),
    null,
  );
});

test("set_mode: known modes only, for the current chat", () => {
  assert.deepEqual(
    ValidateAndParse({ kind: "set_mode", mode: "off", session_id: "x" }, session_id),
    {
      kind: "set_mode",
      session_id,
      mode: "off",
    },
  );
  assert.equal(ValidateAndParse({ kind: "set_mode", mode: "loud" }, session_id), null);
});

test("answer: how sure and a pointed-at line pass; anything else is dropped", () => {
  const base = { kind: "answer", ask_id: "a", nonce: "n", response: "answered", value: "x" };
  assert.deepEqual(
    ValidateAndParse({ ...base, sure: "guess", evidence: "shop/cart.py:22" }, session_id),
    {
      ...base,
      sure: "guess",
      evidence: "shop/cart.py:22",
    },
  );
  assert.equal(ValidateAndParse({ ...base, sure: "certain" }, session_id), null);
  assert.deepEqual(ValidateAndParse({ ...base, evidence: "rm -rf /;:1" }, session_id), base);
});

test("ask events and Recall: known events only, for the current chat", () => {
  const raw = {
    kind: "ask_event",
    ask_id: "a",
    event: "skip_reason",
    value: "no time",
    session_id: "evil",
  };
  assert.deepEqual(ValidateAndParse(raw, session_id), { ...raw, session_id });
  assert.equal(ValidateAndParse({ ...raw, event: "grade_me" }, session_id), null);
  assert.deepEqual(ValidateAndParse({ kind: "recall" }, session_id), {
    kind: "recall",
    session_id,
  });
});
