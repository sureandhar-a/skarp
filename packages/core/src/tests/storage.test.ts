import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { LedgerEvent } from "@skarp/schema";
import { Storage } from "../index.ts";

let testDirPath: string;

beforeEach(() => {
  testDirPath = fs.mkdtempSync(path.join(os.tmpdir(), "skarp-storage-test-"));
});

afterEach(() => {
  fs.rmSync(testDirPath, { recursive: true, force: true });
});

test("append a line to a file", async () => {
  const storage = new Storage();
  const testFilePath = path.join(testDirPath, "test_file.jsonl");
  const event: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    type: "user_message",
    time: new Date().toISOString(),
    session_id: "test-session",
    provenance: "typed",
    schema_version: 1,
    why_kept: "This is a test message.",
    refs: [],
    payload: {},
  };
  const testLine = JSON.stringify(event);

  await storage.append(testFilePath, testLine);

  const lines = await storage.readAll(testDirPath);
  assert(
    lines.some((line) => line.includes(testLine)),
    "The line was not appended correctly.",
  );
});

test("append to a non-existent sub-directory automatically creates it", async () => {
  const storage = new Storage();
  const subDirPath = path.join(testDirPath, "nested", "sub_dir");
  const testFilePath = path.join(subDirPath, "test_file.jsonl");
  const event: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    type: "user_message",
    time: new Date().toISOString(),
    session_id: "test-session",
    provenance: "typed",
    schema_version: 1,
    why_kept: "This is a test message in a nested directory.",
    refs: [],
    payload: {},
  };
  const testLine = JSON.stringify(event);

  await storage.append(testFilePath, testLine);

  const lines = await storage.readAll(subDirPath);
  assert(
    lines.some((line) => line.includes(testLine)),
    "The line was not appended correctly in the nested directory.",
  );
});

test("read all lines from a directory", async () => {
  const storage = new Storage();
  const event1: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    type: "user_message",
    time: new Date().toISOString(),
    session_id: "test-session-1",
    provenance: "typed",
    schema_version: 1,
    why_kept: "This is the first test message.",
    refs: [],
    payload: {},
  };
  const event2: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    type: "user_message",
    time: new Date().toISOString(),
    session_id: "test-session-2",
    provenance: "typed",
    schema_version: 1,
    why_kept: "This is the second test message.",
    refs: [],
    payload: {},
  };

  const filePath = path.join(testDirPath, "test_file.jsonl");
  await storage.append(filePath, JSON.stringify(event1));
  await storage.append(filePath, JSON.stringify(event2));

  const lines = await storage.readAll(testDirPath);
  assert(lines.length >= 2, "Not all lines were read from the directory.");
  assert(
    lines.some((line) => line.includes(JSON.stringify(event1))),
    "The first event was not read correctly.",
  );
  assert(
    lines.some((line) => line.includes(JSON.stringify(event2))),
    "The second event was not read correctly.",
  );
});

test("read all lines with duplicates from a directory", async () => {
  const storage = new Storage();
  const event1: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    type: "user_message",
    time: new Date().toISOString(),
    session_id: "test-session-1",
    provenance: "typed",
    schema_version: 1,
    why_kept: "This is the first test message.",
    refs: [],
    payload: {},
  };

  const filePath = path.join(testDirPath, "test_file.jsonl");
  await storage.append(filePath, JSON.stringify(event1));
  await storage.append(filePath, JSON.stringify(event1));

  const lines = await storage.readAll(testDirPath);
  assert.equal(lines.length, 1, "Duplicate lines were not filtered out.");
  assert(lines[0]?.includes(JSON.stringify(event1)), "The event was not read correctly.");
});

test("two separate windows writing to different files in the same directory", async () => {
  const storage = new Storage();
  const event1: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    type: "user_message",
    time: new Date().toISOString(),
    session_id: "test-session-1",
    provenance: "typed",
    schema_version: 1,
    why_kept: "This is the first test message.",
    refs: [],
    payload: {},
  };
  const event2: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    type: "user_message",
    time: new Date().toISOString(),
    session_id: "test-session-2",
    provenance: "typed",
    schema_version: 1,
    why_kept: "This is the second test message.",
    refs: [],
    payload: {},
  };
  const duplicateEvent: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    type: "user_message",
    time: new Date().toISOString(),
    session_id: "test-session-duplicate",
    provenance: "typed",
    schema_version: 1,
    why_kept: "This is a duplicate test message.",
    refs: [],
    payload: {},
  };

  await storage.append(path.join(testDirPath, "writer-1.jsonl"), JSON.stringify(event1));
  await storage.append(path.join(testDirPath, "writer-1.jsonl"), JSON.stringify(duplicateEvent));
  await storage.append(path.join(testDirPath, "writer-2.jsonl"), JSON.stringify(event2));
  await storage.append(path.join(testDirPath, "writer-2.jsonl"), JSON.stringify(duplicateEvent));

  const lines = await storage.readAll(testDirPath);
  assert.equal(
    lines.length,
    3,
    "The number of unique events read from the directory is incorrect.",
  );
  assert(
    lines.some((line) => line.includes(JSON.stringify(event1))),
    "Event 1 was not read correctly.",
  );
  assert(
    lines.some((line) => line.includes(JSON.stringify(event2))),
    "Event 2 was not read correctly.",
  );
  assert(
    lines.some((line) => line.includes(JSON.stringify(duplicateEvent))),
    "Duplicate Event was not read correctly.",
  );
});
