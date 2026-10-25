import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKS } from "@skarp/kernel";
import type { InMessage } from "@skarp/schema";
import { createCore, type Ports } from "../index.ts";
import { cleanReply, runTool } from "../tools.ts";
import { writeWords } from "../words.ts";

// Helper function to create a test Ports object with default implementations
function createTestPorts(overrides: Partial<Ports> = {}): Ports {
  const defaults: Ports = {
    model: { name: "test", complete: async () => ({ text: "default model reply" }) },
    storage: { append: async () => {}, readAll: async () => [], removeAll: async () => {} },
    observation: { record: () => {} },
    repo: {
      readFile: async () => "",
      listFiles: async () => [],
      search: async () => [],
      gitInfo: async () => "",
    },
    run: { run: async () => ({ exit_code: 0, output: "" }) },
    edits: { apply: async () => {} },
    sessions: {
      save: async () => {},
      load: async () => undefined,
      list: async () => [],
      remove: async () => {},
    },
    clock: { now: () => new Date(0) },
    random: () => 0.99, // an "on" chat, never a control chat
    ask: { ask: async () => ({ type: "skip" }) },
  };

  return { ...defaults, ...overrides };
}

test("core acks a message", async () => {
  const core = createCore(createTestPorts(), "");
  const input: InMessage = {
    kind: "user_message",
    text: "Fix the bug",
    session_id: "1234-random",
  };
  const replies = await core.handle(input);

  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.kind, "ask");
});

test("git_info with a commit: shows its diff without secret files, refuses option-like refs", async () => {
  const show =
    "commit abc\n\ndiff --git a/src/a.ts b/src/a.ts\n+ok\ndiff --git a/.env b/.env\n+KEY=1\n";
  const repo = { ...createTestPorts().repo, gitInfo: async (c?: string) => (c ? show : "## main") };
  const call = (input: Record<string, unknown>) =>
    runTool({ id: "1", name: "git_info", input }, repo, new Map());
  const { output, seen } = await call({ commit: "abc" });
  assert.deepEqual(seen, ["src/a.ts"]); // the diff showed it, so claims about it are observed
  assert.match(output, /src\/a\.ts/);
  assert.doesNotMatch(output, /KEY=1/);
  assert.match((await call({ commit: "--output=/tmp/x" })).output, /^Error: Not a commit/);
  assert.equal((await call({})).output, "## main");
});

test("Stop ends a hung model call, and the next message still works", async () => {
  let calls = 0;
  let seen: { role: string }[] = [];
  const core = createCore(
    createTestPorts({
      model: {
        name: "test",
        complete: async ({ messages, signal }) => {
          if (calls === 1) seen = [...messages]; // the first call after Stop
          if (calls++ > 0) return { text: "a reply" };
          return new Promise((_, reject) =>
            signal?.addEventListener("abort", () => reject(signal.reason)),
          );
        },
      },
    }),
    "",
  );
  const session_id = "stop-chat";
  const hung = core.handle({ kind: "user_message", session_id, text: "why is my build slow" });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(await core.handle({ kind: "stop", session_id }), []);
  assert.deepEqual(await hung, []); // nothing from the stopped turn, not even an error

  const next = await core.handle({
    kind: "user_message",
    session_id,
    text: "and what does it test",
  });
  assert(next.some((m) => m.kind === "assistant_reply"));
  // the stopped turn left a valid history: the assistant had the last word before the new message
  assert.deepEqual(
    seen.slice(-2).map((m) => m.role),
    ["assistant", "user"],
  );
});

test("Stop also ends a hung words call for an ask", async () => {
  const core = createCore(
    createTestPorts({
      model: {
        name: "test",
        complete: ({ signal }) =>
          new Promise((_, reject) =>
            signal?.addEventListener("abort", () => reject(signal.reason)),
          ),
      },
    }),
    "",
  );
  const session_id = "stop-words";
  const hung = core.handle({ kind: "user_message", session_id, text: "Fix the bug in auth.ts" });
  await new Promise((r) => setTimeout(r, 10));
  await core.handle({ kind: "stop", session_id });
  assert.deepEqual(await hung, []);
});

test("edits swap a part of a file; whole-file rewrites and big deletions are refused", async () => {
  const file = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const repo = {
    readFile: async (p: string) => (p === "a.py" ? file : Promise.reject(new Error("missing"))),
    listFiles: async () => [],
    search: async () => [],
    gitInfo: async () => "",
  };
  const held = new Map<string, string>();
  const edit = (input: Record<string, unknown>) =>
    runTool({ id: "1", name: "propose_edit", input: { path: "a.py", ...input } }, repo, held);

  const ok = await edit({ old_text: "line 3\n", new_text: "LINE 3\n" });
  assert.match(ok.output, /\+1 −1 lines/);
  assert.equal(held.get("a.py")?.split("\n").length, 20);
  // a second edit builds on the held one
  await edit({ old_text: "line 4\n", new_text: "LINE 4\n" });
  assert.match(held.get("a.py") ?? "", /LINE 3\nLINE 4/);

  assert.match((await edit({ content: "def f(): pass" })).output, /never the whole file/);
  assert.match((await edit({ old_text: "nope", new_text: "x" })).output, /not in the file/);
  assert.match((await edit({ old_text: "line 1", new_text: "x" })).output, /times/); // line 1, 10-19
  const wipe = await edit({
    old_text: file.replace("line 3", "LINE 3").replace("line 4", "LINE 4"),
    new_text: "x",
  });
  assert.match(wipe.output, /would delete/);
  assert.match(held.get("a.py") ?? "", /LINE 3/); // the refused edit changed nothing

  const fresh = await runTool(
    { id: "2", name: "propose_edit", input: { path: "b.py", content: "new" } },
    repo,
    held,
  );
  assert.match(fresh.output, /\+1 −0/);
});

test("report text never reaches the user; a report written as JSON is still used", () => {
  const raw = [
    "The bug is in `line_total`: it uses `>`.",
    "I will now report my claims.",
    'Claims: None.\n{"least_sure": "whether 10 is inclusive", "claims": [{"file": "shop/cart.py", "line": 22, "text": "qty > BULK_QTY"}]}',
    "Let me know if you want the fix.",
  ].join("\n");
  const { text, report } = cleanReply(raw);
  assert.equal(
    text,
    "The bug is in `line_total`: it uses `>`.\n\nLet me know if you want the fix.",
  );
  assert.equal(report?.least_sure, "whether 10 is inclusive");
  assert.deepEqual(cleanReply("Plain answer. {not json}"), { text: "Plain answer. {not json}" });
});

test("an order question shows the steps moved along; their order is the answer", async () => {
  const model = {
    name: "t",
    complete: async () => ({
      text: '{"question": "Order these", "steps": ["reserve", "commit", "release"]}',
    }),
  };
  const words = await writeWords(model, BLOCKS.X4, "", async () => {});
  assert.deepEqual(words.choices, ["commit", "release", "reserve"]);
  assert.equal(words.correct, "reserve → commit → release");
  const bad = { name: "t", complete: async () => ({ text: '{"question": "Fill in ___?"}' }) };
  assert.equal((await writeWords(bad, BLOCKS.K8, "", async () => {})).from, "fallback");
});

test("an edit that puts a file back as it was is no longer held", async () => {
  const repo = {
    readFile: async () => "a\nb",
    listFiles: async () => [],
    search: async () => [],
    gitInfo: async () => "",
  };
  const held = new Map<string, string>();
  const edit = (old_text: string, new_text: string) =>
    runTool(
      { id: "1", name: "propose_edit", input: { path: "t.py", old_text, new_text } },
      repo,
      held,
    );
  await edit("b", "B");
  assert.equal(held.size, 1);
  assert.match((await edit("B", "b")).output, /nothing is held/);
  assert.equal(held.size, 0);
});
