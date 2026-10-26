import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CAP,
  handle,
  levelAnswer,
  levelIn,
  missingSections,
  normalize,
  readAnswers,
  reportFixes,
  SECTIONS,
  writtenFiles,
} from "./hook.ts";

const cwd = "/p";
const report = (body = "") =>
  `Done.\n## skarp: what changed\n${SECTIONS.map((s) => `### ${s}\nx`).join("\n")}\n${body}`;

function session() {
  const home = mkdtempSync(join(tmpdir(), "skarp-"));
  const on = (event: string, extra: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: hook outputs differ per event
    handle({ session_id: "s1", cwd, hook_event_name: event, ...extra }, home) as any;
  return { on };
}

const answer = (on: ReturnType<typeof session>["on"], ...answers: string[]) =>
  on("PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: Object.fromEntries(answers.map((x, i) => [`q${i}`, x])) },
  });

test("a task gets skarp's question as a question card; other tools wait for the answer", () => {
  const { on } = session();
  const out = on("UserPromptSubmit", { prompt: "add retry to fetchUser in src/api.ts" });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /AskUserQuestion/);
  assert.match(ctx, /Level/); // first time only
  assert.match(ctx, /## skarp: what changed/);
  const read = on("PreToolUse", { tool_name: "Read", tool_input: { file_path: "/p/a.ts" } });
  assert.equal(read.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(on("PreToolUse", { tool_name: "AskUserQuestion", tool_input: {} }), undefined);
  answer(on, "src/api.ts, the fetchUser retry loop", "beginner");
  assert.equal(
    on("PreToolUse", { tool_name: "Read", tool_input: { file_path: "/p/a.ts" } }),
    undefined,
  );
  const next = on("UserPromptSubmit", { prompt: "add a cache to src/api.ts" });
  assert.doesNotMatch(next.hookSpecificOutput.additionalContext, /Level/);
  assert.match(next.hookSpecificOutput.additionalContext, /beginner/);
});

test("no question card on this surface: the task goes on (fail open)", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  on("PostToolUseFailure", { tool_name: "AskUserQuestion", error: "unavailable" });
  assert.equal(on("PreToolUse", { tool_name: "Read", tool_input: {} }), undefined);
});

test("Stop sends the AI back once when it never asked; a typed answer then releases the task", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  assert.equal(on("PreToolUse", { tool_name: "ToolSearch", tool_input: {} }), undefined);
  assert.match(on("Stop", { last_assistant_message: "done" }).reason, /AskUserQuestion/);
  // no card here: the AI wrote the question as text; the next message is the answer
  assert.equal(
    on("Stop", { last_assistant_message: "Which part? 1) src/a.ts", stop_hook_active: true }),
    undefined,
  );
  const out = on("UserPromptSubmit", { prompt: "src/a.ts, intermediate" });
  assert.match(out.hookSpecificOutput.additionalContext, /Now do the user's task: add a logger/);
  assert.equal(on("PreToolUse", { tool_name: "Read", tool_input: {} }), undefined);
});

test("chat is not held", () => {
  assert.equal(session().on("UserPromptSubmit", { prompt: "thanks" }), undefined);
});

test("writes past the slice cap are refused; the same file again is not", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  answer(on, "Skip");
  const write = (f: string) =>
    on("PreToolUse", {
      tool_name: "Write",
      tool_input: { file_path: `${cwd}/${f}`, content: "x" },
    });
  for (let i = 0; i < CAP; i++) assert.equal(write(`f${i}.ts`), undefined);
  assert.equal(write("f0.ts"), undefined);
  assert.equal(write("extra.ts").hookSpecificOutput.permissionDecision, "deny");
});

test("Stop sends the AI back once for a missing section, then lets it finish", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  answer(on, "src/a.ts logger");
  const first = on("Stop", { last_assistant_message: "Done, no report." });
  assert.equal(first.decision, "block");
  const second = on("Stop", { last_assistant_message: "Still none.", stop_hook_active: true });
  assert.match(second.systemMessage, /owed/);
  // the next message carries the owed report
  const next = on("UserPromptSubmit", { prompt: "thanks" });
  assert.match(next.hookSpecificOutput.additionalContext, /no complete skarp report/);
});

test('"tests pass" with no passing test run is sent back; after a real run it is not', () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  answer(on, "src/a.ts logger");
  const claim = report("All tests pass.");
  assert.match(on("Stop", { last_assistant_message: claim }).reason, /tests pass/);

  const b = session();
  b.on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  answer(b.on, "src/a.ts logger");
  b.on("PostToolUse", { tool_name: "Bash", tool_input: { command: "pnpm test" } });
  assert.equal(b.on("Stop", { last_assistant_message: claim }).decision, undefined);
});

test("Stop grades the answer against the touched files, never saying correct", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/log.ts" });
  answer(on, "src/log.ts gets a logger function");
  on("PreToolUse", {
    tool_name: "Write",
    tool_input: { file_path: `${cwd}/src/log.ts`, content: "export function logger() {}" },
  });
  const out = on("Stop", { last_assistant_message: report() });
  assert.match(out.systemMessage, /matched/);
  assert.doesNotMatch(out.systemMessage, /correct/i);
});

test("shell writes (>, >>, tee) are counted; quotes, heredoc bodies, fd redirects and outside paths are not", () => {
  const files = (command: string) =>
    writtenFiles({ cwd, tool_name: "Bash", tool_input: { command } }).map((f) => f.path);
  assert.deepEqual(
    files(`mkdir -p src && printf 'console.log("a > b");\\n' > ${cwd}/src/hello.js`),
    ["src/hello.js"],
  );
  assert.deepEqual(files("echo x >> ./log.txt 2>/dev/null && echo y | tee -a notes.md >&2"), [
    "log.txt",
    "notes.md",
  ]);
  assert.deepEqual(files("cat <<'EOF' > page.html\n<div>a</div>\nEOF"), ["page.html"]);
  assert.deepEqual(files("pnpm test > /tmp/test.log 2>&1; ls src"), []);
  assert.deepEqual(files("git status"), []);
});

test("a shell write is graded and capped like a file tool write", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "create hello.js that prints hello world" });
  answer(on, "a new hello.js");
  on("PreToolUse", {
    tool_name: "Bash",
    tool_input: { command: `printf 'console.log("hi")' > ${cwd}/hello.js` },
  });
  const out = on("Stop", { last_assistant_message: report() });
  assert.match(out.systemMessage, /matched/);
  const capped = session();
  capped.on("UserPromptSubmit", { prompt: "create four files" });
  answer(capped.on, "a, b, c and d");
  const denied = capped.on("PreToolUse", {
    tool_name: "Bash",
    tool_input: { command: "echo 1 > a && echo 2 > b && echo 3 > c && echo 4 > d" },
  });
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
});

test("missingSections names what a report lacks", () => {
  assert.deepEqual(missingSections("nothing"), ["report"]);
  assert.deepEqual(missingSections("## skarp: what changed\n### Changes"), SECTIONS.slice(1));
});

test("Copilot: camelCase input and the event name from the command line", () => {
  const n = normalize(
    { sessionId: "v1", toolName: "apply_patch", toolArgs: '{"input":"*** Add File: a.js"}' },
    "PreToolUse",
  );
  assert.equal(n.session_id, "v1");
  assert.equal(n.hook_event_name, "PreToolUse");
  assert.equal(n.tool_input?.input, "*** Add File: a.js");
});

test("Copilot: a patch is counted file by file and refused whole past the cap", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add math helpers in src/math.js" });
  answer(on, "src/math.js");
  const patch = (...files: string[]) =>
    on("PreToolUse", {
      tool_name: "apply_patch",
      tool_input: { input: files.map((f) => `*** Add File: ${f}\n+x`).join("\n") },
    });
  const big = patch("a.js", "b.js", "c.js", "d.js");
  assert.equal(big.permissionDecision, "deny"); // top-level shape for the Copilot harness
  assert.equal(patch("a.js", "b.js"), undefined);
  assert.equal(patch("c.js", "d.js").hookSpecificOutput.permissionDecision, "deny");
});

test("Copilot: a Stop with no reply text is not checked, and says so", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add math helpers in src/math.js" });
  answer(on, "src/math.js");
  on("PreToolUse", {
    tool_name: "create_file",
    tool_input: { filePath: "/p/src/math.js", content: "x" },
  });
  const out = on("Stop", {});
  assert.equal(out.decision, undefined);
  assert.match(out.systemMessage, /not checked here/);
  assert.match(out.systemMessage, /matched|went where/);
});

test("Copilot: a Stop with no reply text reads it from the transcript", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add math helpers in src/math.js" });
  answer(on, "src/math.js");
  const transcript = join(mkdtempSync(join(tmpdir(), "skarp-t-")), "t.jsonl");
  writeFileSync(
    transcript,
    `${JSON.stringify({ message: { role: "assistant", content: "Done." } })}\n`,
  );
  assert.match(on("Stop", { transcript_path: transcript }).reason, /skarp: what changed/);
});

test("VS Code: askQuestions is the question card, and its reply text is the answer", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/log.ts" });
  assert.equal(on("PreToolUse", { tool_name: "vscode_askQuestions", tool_input: {} }), undefined);
  on("PostToolUse", { tool_name: "vscode_askQuestions", tool_response: "src/log.ts logger" });
  on("PreToolUse", {
    tool_name: "create_file",
    tool_input: { filePath: "/p/src/log.ts", content: "logger" },
  });
  assert.match(on("Stop", { last_assistant_message: report() }).systemMessage, /matched/);
});

test("VS Code's answer shape: selected options and free text, or skipped", () => {
  const vs = JSON.stringify({
    answers: {
      skarp: { selected: ["greet.js"], freeText: null, skipped: false },
      Level: { selected: ["beginner"], freeText: null, skipped: false },
    },
  });
  assert.deepEqual(readAnswers(vs), ["greet.js", "beginner"]);
  assert.deepEqual(readAnswers({ answers: { q: "src/a.ts" } }), ["src/a.ts"]);
  assert.deepEqual(readAnswers(JSON.stringify({ answers: { skarp: { skipped: true } } })), [
    "Skip",
  ]);
  assert.deepEqual(readAnswers("plain words"), ["plain words"]);
});

const textAsk = (on: ReturnType<typeof session>["on"], task: string, question: string) => {
  on("UserPromptSubmit", { prompt: task });
  on("Stop", { last_assistant_message: "x" });
  on("Stop", { last_assistant_message: question, stop_hook_active: true });
};

test("small talk or a question back keeps skarp's question waiting; 'actually...' replaces the task", () => {
  const { on } = session();
  textAsk(on, "add a logger to src/a.ts", "Which part?\n1. src/a.ts\n2. src/b.ts");
  assert.match(
    on("UserPromptSubmit", { prompt: "thanks" }).hookSpecificOutput.additionalContext,
    /still waiting/,
  );
  assert.match(
    on("UserPromptSubmit", { prompt: "why do you ask?" }).hookSpecificOutput.additionalContext,
    /still waiting/,
  );
  const out = on("UserPromptSubmit", { prompt: "actually, add a cache to src/c.ts" });
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /Now do the user's task/);
});

test("a numbered pick is read as that option", () => {
  const { on } = session();
  textAsk(
    on,
    "add a logger to src/log.ts",
    "Which part?\n1. **src/log.ts** logger\n2. src/other.ts",
  );
  const out = on("UserPromptSubmit", { prompt: "1" });
  assert.match(out.hookSpecificOutput.additionalContext, /src\/log\.ts logger/);
  on("PreToolUse", {
    tool_name: "Write",
    tool_input: { file_path: "/p/src/log.ts", content: "logger" },
  });
  assert.match(on("Stop", { last_assistant_message: report() }).systemMessage, /matched/);
});

test("no level named keeps it unset; level phrasings are read", () => {
  const { on } = session();
  textAsk(on, "add a logger to src/a.ts", "Which part?");
  on("UserPromptSubmit", { prompt: "the advanced discount path in src/a.ts" });
  const next = on("UserPromptSubmit", { prompt: "add a cache to src/b.ts" });
  assert.match(next.hookSpecificOutput.additionalContext, /Level/);
  assert.equal(levelIn("level: advanced"), "advanced");
  assert.equal(levelIn("set my level to beginner"), "beginner");
  assert.equal(levelAnswer("src/a.ts, I'm a beginner"), "beginner");
  assert.equal(levelAnswer("the advanced discount path in src/a.ts"), undefined);
});

test("a write outside a task still gets the cap and the report", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "thanks" });
  const w = (f: string) =>
    on("PreToolUse", { tool_name: "Write", tool_input: { file_path: `/p/${f}`, content: "x" } });
  for (let i = 0; i < CAP; i++) w(`f${i}.ts`);
  assert.equal(w("extra.ts").hookSpecificOutput.permissionDecision, "deny");
  assert.equal(on("Stop", { last_assistant_message: "done" }).decision, "block");
});

test("only a test runner counts; a pipe or a Copilot nonzero exit is not a pass", () => {
  const claim = report("All tests pass.");
  const run = (tool: string, command: string, tool_response?: string) => {
    const { on } = session();
    on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
    answer(on, "src/a.ts logger");
    on("PostToolUse", { tool_name: tool, tool_input: { command }, tool_response });
    return on("Stop", { last_assistant_message: claim }).decision;
  };
  assert.equal(run("Bash", "cat cart.test.js"), "block");
  assert.equal(run("Bash", "npm test | tail -5"), "block");
  assert.equal(run("Bash", "cd app && npm test"), undefined);
  assert.equal(
    run("run_in_terminal", "npm test", "1 failing\nCommand exited with exit code 1"),
    "block",
  );
  assert.equal(run("run_in_terminal", "npm test", "ok\nexit code 0"), undefined);
});

test("Copilot multi-replace and insert edits are counted with their content", () => {
  const f = writtenFiles({
    cwd,
    tool_name: "copilot_multiReplaceString",
    tool_input: {
      replacements: [
        { filePath: "/p/a.js", newString: "A" },
        { filePath: "/p/b.js", newString: "B" },
      ],
    },
  });
  assert.deepEqual(f, [
    { path: "a.js", content: "A" },
    { path: "b.js", content: "B" },
  ]);
  const ins = writtenFiles({
    cwd,
    tool_name: "copilot_insertEdit",
    tool_input: { filePath: "/p/c.js", code: "C" },
  });
  assert.deepEqual(ins, [{ path: "c.js", content: "C" }]);
});

test("empty, out-of-order or fenced sections, more praise and N/N claims are sent back", () => {
  assert.deepEqual(reportFixes(report()), []);
  const empty = report().replace("### Diagram\nx", "### Diagram\n");
  assert.match(reportFixes(empty).join(), /under `### Diagram`/);
  const swapped = report()
    .replace("### Changes", "### TMP")
    .replace("### How it works", "### Changes")
    .replace("### TMP", "### How it works");
  assert.match(reportFixes(swapped).join(), /order/);
  assert.match(reportFixes(`\`\`\`\n${report()}`).join(), /code block/);
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  answer(on, "src/a.ts logger");
  const out = on("Stop", { last_assistant_message: report("Awesome. 2/2 passing.") });
  assert.match(out.reason, /praise/);
  assert.match(out.reason, /tests pass/);
});

test("an owed report given later clears the flag", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  answer(on, "src/a.ts logger");
  on("Stop", { last_assistant_message: "none" });
  on("Stop", { last_assistant_message: "none", stop_hook_active: true });
  on("UserPromptSubmit", { prompt: "ok go on" });
  assert.match(
    on("Stop", { last_assistant_message: report() }).systemMessage,
    /owed report checked/,
  );
  assert.equal(on("UserPromptSubmit", { prompt: "thanks" }), undefined);
});

test("Copilot CLI harness: tool_result answers, exit code in Bash text, events.jsonl reply, Move to", () => {
  const { on } = session();
  const n = (raw: object) => normalize({ session_id: "s1", ...raw }, "PostToolUse");
  on("UserPromptSubmit", { prompt: "add tax to src/cart.js" });
  const deny = on("PreToolUse", { tool_name: "Read", tool_input: {} });
  assert.match(deny.permissionDecisionReason, /## skarp: what changed/); // rules reach Copilot here
  on(
    "PostToolUse",
    n({
      tool_name: "AskUserQuestion",
      tool_result: {
        result_type: "success",
        text_result_for_llm: "User responded: src/cart.js tax",
      },
    }),
  );
  on("PreToolUse", {
    tool_name: "Edit",
    tool_input: { input: "*** Update File: /p/src/cart.js\n+tax" },
  });
  on(
    "PostToolUse",
    n({
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_result: {
        result_type: "success",
        text_result_for_llm: "1 fail\n<shellId: 4 completed with exit code 1>",
      },
    }),
  );
  const t = join(mkdtempSync(join(tmpdir(), "skarp-t-")), "events.jsonl");
  writeFileSync(
    t,
    `${JSON.stringify({ type: "assistant.message", data: { content: report("All tests pass.") } })}\n`,
  );
  assert.match(on("Stop", { transcript_path: t }).reason, /tests pass/);
  assert.deepEqual(readAnswers({ text_result_for_llm: "User cancelled the request." }), ["Skip"]);
  const moved = writtenFiles({
    cwd,
    tool_name: "Edit",
    tool_input: { input: "*** Update File: /p/a.js\n*** Move to: /p/b.js" },
  });
  assert.deepEqual(
    moved.map((f) => f.path),
    ["a.js", "b.js"],
  );
});

test("Copilot hooks reference: camelCase events, transcriptPath and toolResult are read", () => {
  const n = normalize(
    { sessionId: "c1", transcriptPath: "/t.jsonl", toolResult: "ok" },
    "agentStop",
  );
  assert.equal(n.hook_event_name, "Stop");
  assert.equal(n.transcript_path, "/t.jsonl");
  assert.equal(n.tool_response, "ok");
  assert.equal(
    normalize({ hookEventName: "userPromptSubmitted" }).hook_event_name,
    "UserPromptSubmit",
  );
});

test("SessionStart gives the standing rules in both output shapes", () => {
  const out = session().on("SessionStart");
  assert.match(out.additionalContext, /## skarp: what changed/);
  assert.equal(out.hookSpecificOutput.additionalContext, out.additionalContext);
});

test("a checked report is saved as a file; ledger lines carry the project and task, and field names only", () => {
  const home = mkdtempSync(join(tmpdir(), "skarp-"));
  // biome-ignore lint/suspicious/noExplicitAny: hook outputs differ per event
  const on = (event: string, extra: object = {}): any =>
    handle(normalize({ sessionId: "r1", cwd, hookEventName: event, secret: "x", ...extra }), home);
  on("userPromptSubmitted", { prompt: "add a logger to src/a.ts" });
  answer(on, "Skip");
  on("agentStop", { last_assistant_message: report() });
  const lines = readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const saved = lines.find((l) => l.type === "report");
  assert.match(readFileSync(saved.payload.path, "utf8"), /^## skarp: what changed/);
  assert.ok(lines.every((l) => l.payload.cwd === cwd));
  assert.ok(lines.find((l) => l.type === "ask").payload.task_id);
  const seen = lines.find((l) => l.type === "seen");
  assert.ok(seen.payload.fields.includes("secret"));
  assert.ok(!JSON.stringify(seen).includes('"x"'));
});
