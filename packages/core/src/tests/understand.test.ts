import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ask, InMessage, OutMessage } from "@skarp/schema";
import { buildArea } from "../area.ts";
import { createCore } from "../core.ts";
import type { ModelPort, Ports, RepoPort } from "../ports.ts";
import { byFolder, groupPieces, targetFiles } from "../understand.ts";

const repo: RepoPort = {
  readFile: async (p) => {
    if (p === "src/a.ts") return "";
    throw new Error("missing");
  },
  listFiles: async (glob) => (glob === "src/**/*" ? ["src/a.ts", "src/b.ts", "src/.env"] : []),
  search: async () => [],
  gitInfo: async () =>
    "commit abc\n\ndiff --git a/src/a.ts b/src/a.ts\n+x\ndiff --git a/.env b/.env\n+K=1\n",
};
const model = (text: string): ModelPort => ({ name: "test", complete: async () => ({ text }) });
const noLog = async () => {};

test("targetFiles: a commit's files, a folder's, a single file; secrets never", async () => {
  assert.deepEqual(await targetFiles({ kind: "commit", ref: "abc1234" }, repo), ["src/a.ts"]);
  assert.deepEqual(await targetFiles({ kind: "path", path: "src" }, repo), [
    "src/a.ts",
    "src/b.ts",
  ]);
  assert.deepEqual(await targetFiles({ kind: "path", path: "src/a.ts" }, repo), ["src/a.ts"]);
  assert.deepEqual(await targetFiles({ kind: "path", path: "nope.ts" }, repo), []);
});

test("groupPieces: model names kept, unknown files dropped, at most 3", async () => {
  const files = ["a/x.ts", "a/y.ts", "b/z.ts", "c/w.ts"];
  const reply = JSON.stringify({
    pieces: [
      { name: "Stop button", files: ["a/x.ts", "made/up.ts"], for_task: true },
      { name: "Pager fix", files: ["b/z.ts"] },
      { name: "Ghost", files: ["made/up.ts"] },
      { name: "Docs", files: ["c/w.ts"] },
      { name: "Fourth", files: ["a/y.ts"] },
    ],
  });
  const pieces = await groupPieces(files, "fix the stop bug", model(reply), noLog);
  assert.deepEqual(pieces, [
    { name: "Stop button", files: ["a/x.ts"], for_task: true },
    { name: "Pager fix", files: ["b/z.ts"] },
    { name: "Docs", files: ["c/w.ts"] },
  ]);
  // no task: for_task is ignored
  assert.equal((await groupPieces(files, undefined, model(reply), noLog))[0]?.for_task, undefined);
});

test("groupPieces: one file is one piece, no model call; bad JSON falls back to folders", async () => {
  const fail: ModelPort = { name: "test", complete: async () => assert.fail("no call") };
  assert.deepEqual(await groupPieces(["src/a.ts"], undefined, fail, noLog), [
    { name: "a.ts", files: ["src/a.ts"] },
  ]);
  const pieces = await groupPieces(["p/a/1", "p/a/2", "q/3"], undefined, model("nope"), noLog);
  assert.deepEqual(
    pieces.map((p) => p.name),
    ["p/a", "q"],
  );
});

test("byFolder: past 3 folders, the rest share one piece", () => {
  const pieces = byFolder(["a/1", "a/2", "a/3", "b/1", "b/2", "c/1", "d/1", "top"]);
  assert.deepEqual(
    pieces.map((p) => [p.name, p.files.length]),
    [
      ["a", 3],
      ["b", 2],
      ["Everything else", 3],
    ],
  );
});

// A scripted model for the loop: pieces, ask words, and turns that end with a report.
function loopPorts(
  opts: { forTask?: boolean; lines?: string[]; silent?: boolean; badKey?: boolean } = {},
) {
  const lines = opts.lines ?? [];
  const turns: string[] = []; // the last message the model saw on each turn
  const words: string[] = []; // each prompt for an ask's words
  const ports: Ports = {
    model: {
      name: "test",
      complete: async ({ messages, tools }) => {
        const last = String(messages.at(-1)?.content ?? "");
        if (!tools && last.includes("Group these files")) {
          return {
            text: JSON.stringify({
              pieces: [
                { name: "Stop button", files: ["a/x.ts"], for_task: !!opts.forTask },
                { name: "Pager fix", files: ["b/y.ts", "c/z.ts"] },
              ],
            }),
          };
        }
        if (!tools && last.startsWith("Work out the answer")) {
          return { text: `{"answer": ${opts.badKey ? 1 : 0}}` };
        }
        if (!tools) {
          words.push(last);
          return {
            text: '{"question": "Stop works because?", "choices": ["A", "B", "C"], "correct": 0}',
          };
        }
        turns.push(last);
        return {
          text: opts.silent ? "" : "Here is how it works.",
          tool_calls: [
            // it looks at the code, so its explanation is grounded
            { id: crypto.randomUUID(), name: "git_info", input: { commit: "HEAD" } },
            { id: crypto.randomUUID(), name: "report", input: { least_sure: "x", claims: [] } },
          ],
        };
      },
    },
    storage: {
      append: async (_f, line) => void lines.push(line),
      readAll: async () => [],
      removeAll: async () => {},
    },
    observation: { record: () => {} },
    repo: {
      readFile: async (p) => (p === "src/a.ts" ? "" : Promise.reject(new Error("missing"))),
      listFiles: async () => [],
      search: async () => [],
      gitInfo: async () =>
        ["a/x.ts", "b/y.ts", "c/z.ts"].map((f) => `diff --git a/${f} b/${f}\n+x\n`).join(""),
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
    random: () => 0.99,
    ask: { ask: async () => ({}) },
  };
  return { ports, turns, lines, words };
}

const asks = (out: OutMessage[]) => out.filter((m): m is Ask => m.kind === "ask");
const reply = (ask: Ask | undefined, value: string): InMessage => ({
  kind: "answer",
  ask_id: ask?.ask_id ?? "",
  nonce: ask?.nonce ?? "",
  response: "answered",
  value,
});

test("the loop: pick a piece, miss twice, the plain answer, Done, Shelf, closing Return", async () => {
  const { ports, turns, lines, words } = loopPorts();
  const core = createCore(ports, "");
  const session_id = "u1";
  const [open] = asks(
    await core.handle({
      kind: "user_message",
      session_id,
      text: "help me understand commit 5715d85",
    }),
  );
  assert.equal(open?.block_id, "O1");
  assert.deepEqual(open?.choices, ["Stop button", "Pager fix", "Big picture first"]);

  const [check] = asks(await core.handle(reply(open, "Stop button")));
  assert.match(
    turns.at(-1) ?? "",
    /help me understand commit 5715d85[\s\S]*Explain what commit 5715d85 changed in the piece "Stop button"/,
  );
  assert.match(turns.at(-1) ?? "", /git_info \(commit "5715d85"\)/); // the diff, not whole files
  assert.equal(check?.block_id, "UC1");
  // the check is written from the explanation, not from why you asked
  assert.match(words.at(-1) ?? "", /Here is how it works/);
  assert.doesNotMatch(words.at(-1) ?? "", /help me understand/);

  const missed = await core.handle(reply(check, "B")); // a miss: said, then explained another way
  const [again] = asks(missed);
  assert.deepEqual(missed[0], {
    kind: "notice",
    about: "verdict",
    text: "Doesn't match the code yet. The code's answer: A.",
    pass: false,
  });
  assert.match(turns.at(-1) ?? "", /Explain that one point again another way/);
  assert.equal(again?.block_id, "UC1");

  const [next] = asks(await core.handle(reply(again, "C"))); // a second miss: the plain answer
  assert.match(turns.at(-1) ?? "", /Explain the answer to .* plainly/);
  assert.equal(next?.block_id, "O2");
  assert.deepEqual(next?.choices, ["Pager fix", "Done for now"]);

  const [close] = asks(await core.handle(reply(next, "Done for now")));
  assert.equal(close?.block_id, "A10");
  const left = lines.map((l) => JSON.parse(l)).filter((e) => e.type === "piece_left");
  assert.deepEqual(
    left.map((e) => [e.payload.piece, e.payload.reason]),
    [
      ["Stop button", "missed"],
      ["Pager fix", "left"],
    ],
  );
  const shelf = buildArea(
    lines.map((l) => JSON.parse(l)),
    false,
  ).shelf.map((i) => i.title);
  assert(shelf.includes("Understand: Stop button") && shelf.includes("Understand: Pager fix"));
});

test("understand and fix: once the pieces the task needs pass, the task gets its opening", async () => {
  const { ports } = loopPorts({ forTask: true });
  const core = createCore(ports, "");
  const text = "help me understand and fix the bug in commit 5715d85";
  const [open] = asks(await core.handle({ kind: "user_message", session_id: "u2", text }));
  const [check] = asks(await core.handle(reply(open, "Stop button")));
  const [task] = asks(await core.handle(reply(check, "A"))); // right first time
  assert.equal(task?.block_id, "A14"); // "Where do you think the bug is?"
});

test("a single file is explained straight away, then checked", async () => {
  const { ports, turns } = loopPorts();
  const core = createCore(ports, "");
  const out = await core.handle({
    kind: "user_message",
    session_id: "u3",
    text: "what does src/a.ts do?",
  });
  assert.deepEqual(
    out.map((m) => (m.kind === "ask" ? m.block_id : m.kind)),
    ["assistant_reply", "UC1"],
  );
  assert.match(turns[0] ?? "", /Explain only the piece "a.ts"/);
});

test("Big picture is a map: no check after it, straight to Next piece?", async () => {
  const { ports, turns } = loopPorts();
  const core = createCore(ports, "");
  const text = "help me understand commit 5715d85";
  const [open] = asks(await core.handle({ kind: "user_message", session_id: "u4", text }));
  const out = await core.handle(reply(open, "Big picture first"));
  assert.match(turns.at(-1) ?? "", /Give the big picture/);
  assert.deepEqual(
    out.map((m) => (m.kind === "ask" ? m.block_id : m.kind)),
    ["assistant_reply", "O2"],
  );
  assert.deepEqual(asks(out)[0]?.choices, ["Stop button", "Pager fix", "Done for now"]);
});

test("an empty explanation gets no check; the piece is offered again", async () => {
  const { ports } = loopPorts({ silent: true });
  const core = createCore(ports, "");
  const text = "help me understand commit 5715d85";
  const [open] = asks(await core.handle({ kind: "user_message", session_id: "u5", text }));
  const out = await core.handle(reply(open, "Big picture first"));
  assert.deepEqual(
    out.map((m) => (m.kind === "ask" ? m.block_id : m.kind)),
    ["error", "O2"],
  );
  assert.deepEqual(asks(out)[0]?.choices, [
    "Stop button",
    "Pager fix",
    "Big picture first",
    "Done for now",
  ]);
});

test("a model error on a piece offers the pieces again, never a dead end", async () => {
  const { ports } = loopPorts();
  const complete = ports.model.complete;
  ports.model.complete = async (request) => {
    if (request.tools) throw new Error("Model x is only available to VS Code core.");
    return complete(request);
  };
  const core = createCore(ports, "");
  const text = "help me understand commit 5715d85";
  const [open] = asks(await core.handle({ kind: "user_message", session_id: "u6", text }));
  const out = await core.handle(reply(open, "Big picture first"));
  assert.deepEqual(
    out.map((m) => (m.kind === "ask" ? m.block_id : m.kind)),
    ["error", "O2"],
  );
  assert.deepEqual(asks(out)[0]?.choices, [
    "Stop button",
    "Pager fix",
    "Big picture first",
    "Done for now",
  ]);
});

test("a side question while a check is open: answered briefly, no new card, no re-explaining", async () => {
  const { ports, turns } = loopPorts();
  const core = createCore(ports, "");
  const session_id = "side";
  const [open] = asks(
    await core.handle({
      kind: "user_message",
      session_id,
      text: "help me understand commit 5715d85",
    }),
  );
  const [check] = asks(await core.handle(reply(open, "Stop button")));
  assert.equal(check?.block_id, "UC1");
  const out = await core.handle({ kind: "user_message", session_id, text: "what is a linter?" });
  assert.deepEqual(asks(out), []); // the open check is still the one to answer
  assert.match(turns.at(-1) ?? "", /asked this on the side/);
  assert.doesNotMatch(turns.at(-1) ?? "", /Explain only the piece/);
  // the open check still works
  const next = asks(await core.handle(reply(check as Ask, "A")));
  assert.equal(next[0]?.block_id, "O2");
});

test("a piece explained without reading any code is held back, not taught", async () => {
  const { ports } = loopPorts();
  const complete = ports.model.complete;
  ports.model.complete = async (request) => {
    const result = await complete(request);
    return request.tools
      ? { ...result, tool_calls: result.tool_calls?.filter((c) => c.name === "report") }
      : result;
  };
  const core = createCore(ports, "");
  const [open] = asks(
    await core.handle({
      kind: "user_message",
      session_id: "g",
      text: "help me understand commit 5715d85",
    }),
  );
  const out = await core.handle(reply(open, "Stop button"));
  assert.match(out[0]?.kind === "error" ? out[0].message : "", /without reading the code/);
  assert.equal(asks(out)[0]?.block_id, "O2");
});

test("a key the code doesn't back is not used: the check is asked as text", async () => {
  const { ports, words } = loopPorts({ badKey: true });
  const core = createCore(ports, "");
  const [open] = asks(
    await core.handle({
      kind: "user_message",
      session_id: "k",
      text: "help me understand commit 5715d85",
    }),
  );
  const [check] = asks(await core.handle(reply(open, "Stop button")));
  assert.equal(check?.answer_type, "text");
  assert.equal(check?.choices, undefined);
  assert.match(words.at(-1) ?? "", /The code \(for working out the right answer/);
});

test("new work mid-lesson starts a new part: a divider, the open check owed, no stale card", async () => {
  const { ports } = loopPorts();
  const core = createCore(ports, "");
  const session_id = "seg";
  const [open] = asks(
    await core.handle({
      kind: "user_message",
      session_id,
      text: "help me understand commit 5715d85",
    }),
  );
  await core.handle(reply(open, "Stop button"));
  const out = await core.handle({
    kind: "user_message",
    session_id,
    text: "now write a regex that validates email addresses for the signup form",
  });
  assert.deepEqual(
    out.filter((m) => m.kind === "notice").map((m) => m.kind === "notice" && m.about),
    ["finish", "segment"],
  );
  assert.equal(
    asks(out).some((a) => a.block_id === "UC1" || a.block_id === "K8"),
    false,
  );
});
