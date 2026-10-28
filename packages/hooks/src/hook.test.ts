import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
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
  return { on, home };
}

// the AI's walkthrough (Hear): it cites the code, then one K8 blank with the line it points at
const stand = `Here is where you stand.
## skarp: where you stand
### Your view
"src/a.ts"
### What the code does now
\`src/a.ts:3\` adds the items; the discount takes a fraction.
### What will change
\`src/a.ts:7\` divides the percent by 100.
### The gap
Your view matches the file; it misses the percent.
### Fill the gap
applyDiscount takes the percent off after ___ (src/a.ts:7).`;

// skarp's first question answered on a card; for a task, also Hear (the walkthrough and the
// user's fill) so the AI may then change files
function answer(on: ReturnType<typeof session>["on"], ...answers: string[]) {
  const out = on("PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: Object.fromEntries(answers.map((x, i) => [`q${i}`, x])) },
  });
  if (/where you stand/.test(out?.additionalContext ?? "")) understood(on);
  return out;
}
function understood(on: ReturnType<typeof session>["on"]) {
  on("Stop", { last_assistant_message: stand });
  on("UserPromptSubmit", { prompt: "dividing the percent by 100, so 10 means a tenth" });
}

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
  assert.match(out.hookSpecificOutput.additionalContext, /## skarp: where you stand/);
  assert.equal(on("PreToolUse", { tool_name: "Read", tool_input: {} }), undefined);
  understood(on);
  const write = { tool_name: "Write", tool_input: { file_path: "/p/src/a.ts", content: "x" } };
  assert.equal(on("PreToolUse", write), undefined);
});

test("chat is not held", () => {
  assert.equal(session().on("UserPromptSubmit", { prompt: "thanks" }), undefined);
});

test("no file cap: ten files are written, none refused, and all are graded", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "rename foo to bar across the app" });
  answer(on, "f0.ts to f9.ts");
  for (let i = 0; i < 10; i++)
    assert.equal(
      on("PreToolUse", {
        tool_name: "Write",
        tool_input: { file_path: `${cwd}/f${i}.ts`, content: "bar" },
      }),
      undefined,
    );
  assert.match(on("Stop", { last_assistant_message: report() }).systemMessage, /10 files/);
});

test("Stop sends the AI back once for a missing section, then lets it finish", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  answer(on, "src/a.ts logger");
  on("PreToolUse", { tool_name: "Write", tool_input: { file_path: "/p/src/a.ts", content: "x" } });
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

test("a shell write is graded like a file tool write", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "create hello.js that prints hello world" });
  answer(on, "a new hello.js");
  on("PreToolUse", {
    tool_name: "Bash",
    tool_input: { command: `printf 'console.log("hi")' > ${cwd}/hello.js` },
  });
  const out = on("Stop", { last_assistant_message: report() });
  assert.match(out.systemMessage, /matched/);
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

test("Copilot: a patch is counted file by file", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add math helpers in src/math.js" });
  answer(on, "src/math.js");
  const files = ["a.js", "b.js", "c.js", "d.js"];
  const patch = on("PreToolUse", {
    tool_name: "apply_patch",
    tool_input: { input: files.map((f) => `*** Add File: ${f}\n+x`).join("\n") },
  });
  assert.equal(patch, undefined);
  assert.match(
    on("Stop", { last_assistant_message: report() }).systemMessage,
    /4 files|went where/,
  );
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
  on("PreToolUse", { tool_name: "Write", tool_input: { file_path: "/p/src/a.ts", content: "x" } });
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
  understood(on);
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
  understood(on);
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

test("a write outside a task still gets the report", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "thanks" });
  on("PreToolUse", { tool_name: "Write", tool_input: { file_path: "/p/f.ts", content: "x" } });
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
  assert.equal(run("Bash", "npm test; echo exit=$?"), "block");
  assert.equal(run("Bash", "npm test || true"), "block");
  assert.equal(run("Bash", "npm test && echo ok"), undefined);
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
  on("PreToolUse", { tool_name: "Write", tool_input: { file_path: "/p/src/a.ts", content: "x" } });
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
  understood(on);
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

// understand: the big picture, then one part at a time on cards (framework §18, D179-D185)
const bigPicture = `Here.
## skarp: big picture
### What it is
A picker for the network interface.
### What it solves
Choosing one interface out of many.
### The main parts
- **Picker**: lists the interfaces (src/pick.ts)
- **Apply**: applies the choice (src/apply.ts)
They run in that order.`;
const onePart = `## skarp: one part
### What it is
The picker.
### Why it exists
Many interfaces.
### How it works
src/pick.ts:3 filters them.
### Fill the gap
pick() keeps only the interfaces that are ___ (src/pick.ts:3).`;
const card = (question: string, ...options: string[]) => ({
  tool_name: "AskUserQuestion",
  tool_input: { questions: [{ question, options: options.map((label) => ({ label })) }] },
});
const picked = (a: string) => ({
  tool_name: "AskUserQuestion",
  tool_response: { answers: { q: a } },
});

test("understand: big picture, a card, Not understood retold, a part with its blank, next, then the recall", () => {
  const { on, home } = session();
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  const start = on("UserPromptSubmit", {
    prompt: "i want to understand interface selection",
  });
  assert.match(ctx(start), /## skarp: big picture/);
  assert.match(ctx(start), /understand interface selection\./);
  assert.match(
    ctx(start),
    /"Does the big picture make sense\?".*"Proceed next", "Not understood", "Skip"/,
  );
  assert.doesNotMatch(ctx(start), /what do you think it does now/); // no opening guess (D182)
  const write = on("PreToolUse", { tool_name: "Write", tool_input: { file_path: "/p/a.ts" } });
  assert.equal(write.permissionDecision, "deny");
  assert.equal(
    on("PreToolUse", { tool_name: "Read", tool_input: { file_path: "/p/a.ts" } }),
    undefined,
  );

  // the big picture written, its card not asked: it's due now
  assert.match(on("Stop", { last_assistant_message: bigPicture }).reason, /now ask the card/);
  const o0 = "Does the big picture make sense?";
  assert.match(
    on("PreToolUse", card(o0, "Yes", "No")).hookSpecificOutput.permissionDecisionReason,
    /exactly these options/,
  );
  assert.equal(on("PreToolUse", card(o0, "Proceed next", "Not understood", "Skip")), undefined);
  assert.match(ctx(on("PostToolUse", picked("Not understood"))), /simpler words/);
  on("PreToolUse", card(o0, "Proceed next", "Not understood", "Skip"));
  const orient = ctx(on("PostToolUse", picked("Proceed next")));
  assert.match(orient, /"Where do we start\?".*"Picker", "Apply", "Skip"/);
  // other tools wait for the card
  assert.equal(on("PreToolUse", { tool_name: "Read" }).permissionDecision, "deny");
  on("PreToolUse", card("Where do we start?", "Picker", "Apply"));
  const part = ctx(on("PostToolUse", picked("Picker")));
  assert.match(part, /explain only this part: Picker/);
  assert.match(part, /Fill the gap \(K8\)/);

  // the part's card asks its blank; without one it's refused, and the refusal isn't a skip
  assert.match(
    on("PreToolUse", card("Did that make sense?", "Not understood")).hookSpecificOutput
      .permissionDecisionReason,
    /Fill the gap statement/,
  );
  assert.equal(on("PostToolUseFailure", { tool_name: "AskUserQuestion" }), undefined);
  assert.equal(
    on(
      "PreToolUse",
      card("pick() keeps only the interfaces that are ___ (src/pick.ts:3).", "Not understood"),
    ),
    undefined,
  );
  const next = ctx(on("PostToolUse", picked("the ones that are up")));
  assert.match(next, /"Next piece\?".*"Apply", "Done for now", "Skip"/);
  on("PreToolUse", card("Next piece?", "Apply", "Done for now"));
  const end = ctx(on("PostToolUse", picked("Done for now")));
  assert.match(end, /## skarp: understood so far/);
  assert.match(end, /Picker: answered/);
  assert.match(end, /not covered \(Apply\)/);
  assert.match(end, /"In one line: how does interface selection work\?"/);
  on("PreToolUse", card("In one line: how does interface selection work?", "Not yet"));
  assert.match(ctx(on("PostToolUse", picked("it filters, then applies"))), /what in it matches/);
  // the part left goes to the Shelf; the walk-through is kept as one file
  const ledger = readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8");
  assert.match(ledger, /"type":"shelf".*"parts":\["Apply"\]/);
  const saved = JSON.parse(
    ledger
      .trim()
      .split("\n")
      .findLast((l) => l.includes('"kind":"understand"')) ?? "{}",
  );
  const md = readFileSync(saved.payload.path, "utf8");
  assert.match(md, /^# Understood: interface selection$/m);
  assert.match(md, /## skarp: big picture/);
  assert.match(md, /## Picker \(answered, not checked\)/);
  assert.match(md, /## Not yet\n- Apply/);
  assert.match(md, /## In your own words\nit filters, then applies/);
  // the walk-through is over: "build it" starts a task from what was explained
  assert.match(ctx(on("UserPromptSubmit", { prompt: "build it" })), /interface selection/);
});

test("understand: a big picture missing its parts is sent back; asked as text, a typed answer counts", () => {
  const { on } = session();
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  on("UserPromptSubmit", { prompt: "can you explain the repo to me" });
  assert.match(
    on("Stop", { last_assistant_message: "It's a CLI." }).reason,
    /understand check:[\s\S]*## skarp: big picture/,
  );
  const asText = `${bigPicture}\nDoes the big picture make sense?\n1. Proceed next\n2. Not understood\n3. Skip`;
  assert.equal(on("Stop", { last_assistant_message: asText, stop_hook_active: true }), undefined);
  // a question back is not the answer; "not understood", typed, is
  assert.match(ctx(on("UserPromptSubmit", { prompt: "what's a picker?" })), /still waiting/);
  assert.match(ctx(on("UserPromptSubmit", { prompt: "not understood" })), /simpler words/);
  // a part written without its blank is sent back
  on("Stop", { last_assistant_message: bigPicture });
  on("UserPromptSubmit", { prompt: "proceed next" });
  on("UserPromptSubmit", { prompt: "Apply" });
  assert.match(
    on("Stop", { last_assistant_message: onePart.replace(/pick\(\).*$/m, "It filters.") }).reason,
    /ending in ___/,
  );
});

test("understand: the feature is the target; three Not understood at most, then on", () => {
  const { on } = session();
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  on("UserPromptSubmit", { prompt: "how does the cart work?" });
  on("Stop", { last_assistant_message: bigPicture });
  const o0 = card("Does the big picture make sense?", "Proceed next", "Not understood");
  const angles = [/simpler words/, /analogy/, /plainest form/];
  for (const angle of angles) {
    on("PreToolUse", o0);
    assert.match(ctx(on("PostToolUse", picked("Not understood"))), angle);
  }
  on("PreToolUse", o0);
  assert.match(ctx(on("PostToolUse", picked("Not understood"))), /Where do we start\?/);
  on("PreToolUse", card("Where do we start?", "Picker", "Apply"));
  assert.match(ctx(on("PostToolUse", picked("Apply"))), /explain only this part: Apply/);
  on("Stop", { last_assistant_message: onePart });
  assert.match(ctx(on("UserPromptSubmit", { prompt: "skip" })), /Next piece\?/);
  on("UserPromptSubmit", { prompt: "Picker" });
  on("Stop", { last_assistant_message: onePart });
  assert.match(
    ctx(on("UserPromptSubmit", { prompt: "the ones it filters" })),
    /In one line: how does the cart work\?/,
  );
});

test("understand: the fill is checked against the cited line; a miss is retold, the second gets the plain answer", () => {
  const home = mkdtempSync(join(tmpdir(), "skarp-"));
  const dir = mkdtempSync(join(tmpdir(), "repo-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "apply.ts"), "export const apply = () => {};\n");
  writeFileSync(
    join(dir, "src", "pick.ts"),
    "// pick\n\nexport const pick = (all) => all.filter((i) => i.up);\n",
  );
  let sid = "u1";
  // biome-ignore lint/suspicious/noExplicitAny: hook outputs differ per event
  const on = (event: string, extra: object = {}): any =>
    handle({ session_id: sid, cwd: dir, hook_event_name: event, ...extra }, home);
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  const blank = card(
    "pick() keeps only the interfaces that are ___ (src/pick.ts:3).",
    "Not understood",
  );
  const toPart = () => {
    on("UserPromptSubmit", { prompt: "explain interface selection" });
    on("Stop", { last_assistant_message: bigPicture });
    on("UserPromptSubmit", { prompt: "proceed next" });
    on("UserPromptSubmit", { prompt: "Picker" });
    on("PreToolUse", blank);
  };
  toPart();
  // names something on the line: matched
  const pass = ctx(on("PostToolUse", picked("the ones whose up flag is set")));
  assert.match(pass, /matches the code at src\/pick.ts:3/);
  assert.match(pass, /Next piece\?/);

  sid = "u2";
  toPart();
  const miss = ctx(on("PostToolUse", picked("the fast ones")));
  assert.match(miss, /explain that point another way/);
  assert.doesNotMatch(miss, /Next piece/);
  // the retry brings only a new blank: no part shape is asked for
  assert.match(
    on("Stop", {
      last_assistant_message:
        "Put another way.\n### Fill the gap\npick() drops each interface that is not ___ (src/pick.ts:3).",
    }).reason,
    /now ask the card/,
  );
  const plain = ctx(on("UserPromptSubmit", { prompt: "the cheap ones" }));
  assert.match(plain, /Give the plain answer now/);
  assert.match(plain, /Next piece\?/);
  const ledger = readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8");
  assert.match(ledger, /"result":"pass"/);

  // what a step cites must be a real file here: a made-up path is sent back
  sid = "u3";
  on("UserPromptSubmit", { prompt: "explain interface selection" });
  const madeUp = on("Stop", {
    last_assistant_message: bigPicture.replace("src/apply.ts", "src/nowhere.ts"),
  });
  assert.match(
    madeUp.reason,
    /src\/nowhere\.ts isn't in this project: name the real file for Apply/,
  );
  assert.match(ledger, /"reason":"missed twice"/);
});

test("brainstorm: your idea first, quiet while listing, stress, then a decision with your why, all recorded", () => {
  const home = mkdtempSync(join(tmpdir(), "skarp-"));
  // biome-ignore lint/suspicious/noExplicitAny: hook outputs differ per event
  const on = (event: string, extra: object = {}): any =>
    handle({ session_id: "b1", cwd, hook_event_name: event, ...extra }, home);
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  const start = on("UserPromptSubmit", { prompt: "can we brainstorm on caching the user API?" });
  assert.match(ctx(start), /what's your idea or first guess/);
  assert.match(ctx(start), /"I'll type my idea", "Your ideas first"/);
  assert.match(ctx(start), /Do not suggest ideas/);
  // the card answer is the user's first idea
  const first = on("PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: { q: "cache per user in memory" } },
  });
  assert.match(first.hookSpecificOutput.additionalContext, /I1 \(you\)/);
  // listing: a verdict is sent back
  const listMap = "### skarp map\n- verdict I1: risky, stale";
  assert.match(
    on("Stop", { last_assistant_message: `Noted.\n${listMap}` }).reason,
    /still listing/,
  );
  on("Stop", {
    last_assistant_message: "Noted. Anything else?\n### skarp map\n- open: size",
    stop_hook_active: true,
  });
  assert.match(
    ctx(on("UserPromptSubmit", { prompt: "or a redis cache shared by all servers" })),
    /I2 \(you\)/,
  );
  assert.match(ctx(on("UserPromptSubmit", { prompt: "done" })), /Phase: stress test/);
  // writes are refused during a brainstorm
  const w = on("PreToolUse", {
    tool_name: "Write",
    tool_input: { file_path: "/p/a.ts", content: "x" },
  });
  assert.match(w.hookSpecificOutput.permissionDecisionReason, /brainstorm mode changes no files/);
  on("Stop", {
    last_assistant_message:
      'Restated: Would a shared Redis cache keep data fresh?\n### Question\nYou said "shared by all servers": how is it invalidated?\n### skarp map\n- verdict I2: unknown, no invalidation yet\n- question failure: "shared by all servers"',
  });
  // deciding with a reason closes and saves it
  const done = on("UserPromptSubmit", {
    prompt: "let's go with redis because every server needs the same data",
  });
  assert.match(ctx(done), /recorded the user's decision/);
  const ledger = readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const bs = ledger.find((l) => l.type === "brainstorm");
  assert.equal(bs.payload.ideas_by_you, 2);
  assert.equal(bs.payload.coverage, 1);
  const md = readFileSync(bs.payload.path, "utf8");
  assert.match(md, /because every server needs the same data/);
  assert.match(md, /verdict: unknown/);
  // "build it" starts the decision as a task without asking again, explained first
  const build = on("UserPromptSubmit", { prompt: "build it" });
  assert.doesNotMatch(ctx(build), /AskUserQuestion/);
  assert.match(ctx(build), /## skarp: where you stand/);
  // a later "continue the brainstorm" brings the saved record back
  const resumed = on("UserPromptSubmit", { prompt: "continue the brainstorm on caching" });
  assert.match(ctx(resumed), /continues an earlier brainstorm/);
  assert.match(ctx(resumed), /because every server needs the same data/);
});

test("brainstorm: an idea in the request skips the question; deciding needs two options and a why", () => {
  const { on } = session();
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  const start = on("UserPromptSubmit", {
    prompt: "I have a rough idea: move the job queue to postgres. can we brainstorm?",
  });
  assert.match(ctx(start), /I1 \(you\)/);
  on("UserPromptSubmit", { prompt: "done" });
  assert.match(ctx(on("UserPromptSubmit", { prompt: "let's decide" })), /at least two options/);
  assert.match(ctx(on("UserPromptSubmit", { prompt: "your ideas please" })), /stress test/);
});

test("a bug fix over three turns: one question, status while unfinished, one report and one grade on all files", () => {
  const home = mkdtempSync(join(tmpdir(), "skarp-"));
  // biome-ignore lint/suspicious/noExplicitAny: hook outputs differ per event
  const on = (event: string, extra: object = {}): any =>
    handle({ session_id: "m1", cwd, hook_event_name: event, ...extra }, home);
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  const start = on("UserPromptSubmit", {
    prompt: "login fails on empty password in src/auth.ts, can you fix it",
  });
  assert.match(ctx(start), /Where do you think the bug is/);
  assert.match(ctx(start), /What would show it's fixed/);
  on("PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: { q1: "src/auth.ts validate", q2: "A test passes", q3: "beginner" } },
  });
  understood(on);
  const write = (f: string) =>
    on("PreToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: `${cwd}/${f}`, new_string: "x" },
    });
  write("src/auth.ts");
  // turn 1 ends unfinished, with a status: nothing owed, no grade yet
  assert.equal(
    on("Stop", { last_assistant_message: "Tried a guard.\n### skarp: status\nnext: run it" }),
    undefined,
  );
  const turn2 = on("UserPromptSubmit", { prompt: "still failing" });
  assert.match(ctx(turn2), /continues the open task/);
  assert.doesNotMatch(ctx(turn2), /AskUserQuestion/);
  write("src/validate.ts");
  // changed files with neither status nor report: sent back once
  assert.match(
    on("Stop", { last_assistant_message: "Changed it." }).reason,
    /neither the report nor a status/,
  );
  on("Stop", { last_assistant_message: "x\n### skarp: status\nnext", stop_hook_active: true });
  const turn3 = on("UserPromptSubmit", { prompt: "works now" });
  assert.match(ctx(turn3), /Give the full skarp report now/);
  assert.match(ctx(turn3), /"A test passes"/);
  const end = on("Stop", { last_assistant_message: report() });
  assert.match(end.systemMessage, /2 files|went where/);
  const outcomes = readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.includes('"outcome"'));
  assert.equal(outcomes.length, 1);
});

test("an open task: a different task starts fresh, 'actually' replaces, a reply with nothing changed owes nothing", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  answer(on, "src/a.ts");
  assert.equal(on("Stop", { last_assistant_message: "Looking around first." }), undefined);
  const other = on("UserPromptSubmit", { prompt: "add a cache to src/b.ts" });
  assert.match(other.hookSpecificOutput.additionalContext, /AskUserQuestion/);
  answer(on, "src/b.ts");
  const replaced = on("UserPromptSubmit", { prompt: "actually, rename foo in src/b.ts" });
  assert.doesNotMatch(replaced.hookSpecificOutput.additionalContext, /continues the open task/);
});

test("the first question: code's hints only; a card with the AI's own options or wording is refused", () => {
  const { on } = session();
  const start = on("UserPromptSubmit", { prompt: "login fails on empty password, fix it" });
  assert.match(
    start.hookSpecificOutput.additionalContext,
    /"UI", "Data or API", "Config or environment"/,
  );
  const card = (question: string, ...labels: string[]) =>
    on("PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question, options: labels.map((label) => ({ label })) }] },
    });
  const guessed = card("Where do you think the bug is?", "src/auth.ts validate()", "Skip");
  assert.match(guessed.hookSpecificOutput.permissionDecisionReason, /Use exactly these options/);
  const reworded = card("May I proceed?", "UI", "Skip");
  assert.match(reworded.hookSpecificOutput.permissionDecisionReason, /word for word/);
  // after two refusals the card goes through rather than lock the user out (rule 17)
  assert.equal(card("May I proceed?", "x"), undefined);
  const ok = session();
  ok.on("UserPromptSubmit", { prompt: "login fails on empty password, fix it" });
  assert.equal(
    ok.on("PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            question: "Where do you think the bug is?",
            options: [{ label: "UI" }, { label: "Skip" }],
          },
        ],
      },
    }),
    undefined,
  );
});

test("the question as text: the AI's own numbered options are sent back once", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  on("Stop", { last_assistant_message: "no question" });
  const text = on("Stop", {
    last_assistant_message: "Which part?\n1. src/a.ts logger\n2. Skip",
  });
  assert.match(text.reason, /exactly these options/);
});

test("brainstorm: 'end brainstorm' only ends it, and a later resume brings it back", () => {
  const { on } = session();
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  on("UserPromptSubmit", { prompt: "I have a rough idea: cache prices in memory. brainstorm?" });
  assert.match(
    ctx(on("UserPromptSubmit", { prompt: "continue the brainstorm" })),
    /continues the open brainstorm/,
  );
  const end = on("UserPromptSubmit", { prompt: "end brainstorm" });
  assert.match(ctx(end), /ended the brainstorm/);
  assert.doesNotMatch(ctx(end), /what's your idea/);
  const back = on("UserPromptSubmit", { prompt: "continue the brainstorm on caching prices" });
  assert.match(ctx(back), /continues an earlier brainstorm/);
  assert.doesNotMatch(ctx(back), /The user.s idea, I/);
});

test("brainstorm: a hard-to-undo pick with a reason gets the pre-mortem before it's recorded", () => {
  const { on } = session();
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  on("UserPromptSubmit", { prompt: "I have a rough idea: store money as floats in the schema" });
  on("UserPromptSubmit", { prompt: "or store cents as integers" });
  on("UserPromptSubmit", { prompt: "done" });
  const pick = on("UserPromptSubmit", { prompt: "let's go with cents because floats drift" });
  assert.match(ctx(pick), /Pre-mortem/);
  assert.doesNotMatch(ctx(pick), /recorded the user's decision/);
  const after = on("UserPromptSubmit", { prompt: "rounding on old rows, but we can backfill" });
  assert.match(
    ctx(after),
    /recorded the user's decision: "let's go with cents because floats drift"/,
  );
});

test("Copilot: ask_user is the question tool, its answer is read, and a replayed send-back is not the user's", () => {
  const home = mkdtempSync(join(tmpdir(), "skarp-"));
  // biome-ignore lint/suspicious/noExplicitAny: hook outputs differ per event
  const cop = (event: string, raw: object): any =>
    handle(normalize({ sessionId: "c1", cwd, ...raw }, event), home);
  cop("userPromptSubmitted", { prompt: "create hello.js that prints hello world" });
  const q = "Which part of the code do you expect this change to touch?";
  const guessed = cop("preToolUse", {
    toolName: "ask_user",
    toolArgs: {
      message: q,
      requestedSchema: { properties: { t: { type: "string", default: "hello.js" } } },
    },
  });
  assert.match(guessed.permissionDecisionReason, /Leave out the default/);
  // the AI stops without asking: sent back, and Copilot replays the reason as a prompt
  const back = cop("agentStop", { stopReason: "end_turn", stop_hook_active: false });
  assert.equal(back.decision, "block");
  assert.equal(cop("userPromptSubmitted", { prompt: back.reason }), undefined);
  const ok = cop("preToolUse", {
    toolName: "ask_user",
    toolArgs: { message: q, requestedSchema: { properties: { t: { type: "string" } } } },
  });
  assert.equal(ok, undefined);
  cop("postToolUse", {
    toolName: "ask_user",
    toolArgs: { message: q },
    toolResult: { textResultForLlm: "User responded: a new hello.js file", resultType: "success" },
  });
  const ledger = readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8");
  assert.match(ledger, /"text":"a new hello.js file"/);
  assert.doesNotMatch(ledger, /"type":"answer"[^\n]*skarp: ask the user/);
});

test("end checks: options sent back on the second Stop, and a test-only bug fix", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  on("Stop", { last_assistant_message: "Which part?" });
  const own = on("Stop", {
    last_assistant_message: "Which part?\n- the logger module\n- the config",
    stop_hook_active: true,
  });
  assert.match(own.reason, /as a numbered list: 1\./);

  const bug = session();
  bug.on("UserPromptSubmit", { prompt: "applyDiscount is broken in cart.js, can you fix it" });
  answer(bug.on, "cart.js applyDiscount", "A test passes");
  bug.on("PreToolUse", {
    tool_name: "Edit",
    tool_input: { file_path: "/p/cart.test.js", new_string: "0.1" },
  });
  assert.match(
    bug.on("Stop", { last_assistant_message: report() }).reason,
    /changed only test files/,
  );
});

test("follow-ups: done words anywhere, 'still failing' after the report reopens, chat with nothing changed is chat", () => {
  const { on } = session();
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  on("UserPromptSubmit", { prompt: "applyDiscount is broken in cart.js, can you fix it" });
  answer(on, "cart.js applyDiscount", "A test passes", "beginner");
  on("PreToolUse", {
    tool_name: "Edit",
    tool_input: { file_path: "/p/cart.js", new_string: "/ 100" },
  });
  on("Stop", { last_assistant_message: "Tried it.\n### skarp: status\nnext: run tests" });
  assert.match(
    ctx(on("UserPromptSubmit", { prompt: "yep that fixed it" })),
    /says the task is done/,
  );
  on("Stop", { last_assistant_message: report() });
  const again = on("UserPromptSubmit", { prompt: "hmm it's still failing on 0 percent" });
  assert.match(ctx(again), /last task isn't done/);
  assert.doesNotMatch(ctx(again), /AskUserQuestion/);

  const quiet = session();
  quiet.on("UserPromptSubmit", { prompt: "add a retry to src/api.ts" });
  answer(quiet.on, "src/api.ts", "beginner");
  quiet.on("Stop", { last_assistant_message: "Looking first." });
  assert.equal(quiet.on("UserPromptSubmit", { prompt: "how's the weather" }), undefined);
});

test("ledger: a new task's user_message carries the new task's id; the grade has its wording", () => {
  const home = mkdtempSync(join(tmpdir(), "skarp-"));
  const on = (event: string, extra: object = {}) =>
    handle({ session_id: "l1", cwd, hook_event_name: event, ...extra }, home);
  on("UserPromptSubmit", { prompt: "add a logger to src/a.ts" });
  on("PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: { q: "src/a.ts", l: "beginner" } },
  });
  understood(on);
  on("PreToolUse", {
    tool_name: "Write",
    tool_input: { file_path: "/p/src/a.ts", content: "log" },
  });
  on("Stop", { last_assistant_message: report() });
  on("UserPromptSubmit", { prompt: "add a cache to src/b.ts" });
  const lines = readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const msgs = lines.filter((l) => l.type === "user_message");
  const asks = lines.filter((l) => l.type === "ask");
  assert.equal(msgs.at(-1).payload.task_id, asks.at(-1).payload.task_id);
  assert.notEqual(msgs.at(-1).payload.task_id, asks[0].payload.task_id);
  assert.match(lines.find((l) => l.type === "outcome").payload.text, /your plan matched/);
});

// a project on disk, so the K8 fill is checked against the real line it cites
function project() {
  const home = mkdtempSync(join(tmpdir(), "skarp-"));
  const dir = mkdtempSync(join(tmpdir(), "skarp-p-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "src", "a.ts"),
    "export function applyDiscount(total, pct) {\n  return total - total * (pct / 100);\n}\n",
  );
  const on = (sid: string, event: string, extra: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: hook outputs differ per event
    handle({ session_id: sid, cwd: dir, hook_event_name: event, ...extra }, home) as any;
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  const ledger = () =>
    readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  const walk = stand.replaceAll("src/a.ts:7", "src/a.ts:2");
  return { on, ctx, ledger, dir, walk };
}

test("Hear: the walkthrough and a K8 blank before any change; the fill is checked against the cited line", () => {
  const { on, ctx, ledger, dir, walk } = project();
  const write = { tool_name: "Write", tool_input: { file_path: `${dir}/src/a.ts`, content: "x" } };
  on("s1", "UserPromptSubmit", { prompt: "add a cap to applyDiscount in src/a.ts" });
  // skipping skarp's question skips the answer, not the walkthrough (Gap: no view yet)
  const skip = on("s1", "PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: { q: "Skip" } },
  });
  assert.match(skip.hookSpecificOutput.additionalContext, /## skarp: where you stand/);
  assert.match(skip.hookSpecificOutput.additionalContext, /No view given/);
  assert.equal(on("s1", "PreToolUse", write).hookSpecificOutput.permissionDecision, "deny");
  // no walkthrough: sent back once, and writes stay refused after it
  assert.match(
    on("s1", "Stop", { last_assistant_message: "Plan: add it." }).reason,
    /Fill the gap/,
  );
  on("s1", "Stop", { last_assistant_message: "Still none.", stop_hook_active: true });
  assert.equal(on("s1", "PreToolUse", write).hookSpecificOutput.permissionDecision, "deny");
  assert.match(
    ctx(on("s1", "UserPromptSubmit", { prompt: "ok go on" })),
    /still needs the walkthrough/,
  );
  // a blank with no line to check is sent back
  const noCite = walk.replace(" (src/a.ts:2)", "");
  assert.match(on("s1", "Stop", { last_assistant_message: noCite }).reason, /file:line/);
  assert.equal(on("s1", "Stop", { last_assistant_message: walk }), undefined);
  assert.equal(on("s1", "PreToolUse", write).hookSpecificOutput.permissionDecision, "deny");
  // a fill that names nothing on the cited line is a miss: explained another way, a new blank
  // "function" is on the cited line, but every line has it: a fill must name this line's own parts
  const miss = ctx(on("s1", "UserPromptSubmit", { prompt: "the function does the math" }));
  assert.match(miss, /another way/);
  assert.match(miss, /Fill the gap/);
  assert.equal(on("s1", "PreToolUse", write).hookSpecificOutput.permissionDecision, "deny");
  // the second miss gets the plain answer, then the build (framework §18)
  const plain = ctx(on("s1", "UserPromptSubmit", { prompt: "it changes the number somehow" }));
  assert.match(plain, /plain answer/);
  assert.match(plain, /Never say they were wrong/);
  assert.equal(on("s1", "PreToolUse", write), undefined);
  const checks = ledger().filter((l) => l.type === "hear_check");
  assert.deepEqual(
    checks.map((l) => l.payload.result),
    ["miss", "miss"],
  );
  assert.equal(checks[0].payload.fact, "src/a.ts:2");
  assert.ok(ledger().some((l) => l.type === "silence" && l.payload.intent === "fly"));
  // the second miss is owed, so the gap comes back in a later chat
  assert.equal(
    ledger()
      .filter((l) => l.type === "owed")
      .at(-1).payload.reason,
    "missed twice",
  );
  assert.ok(!ledger().some((l) => l.payload.block === "GO"));
});

test("Return: a fill that passed comes back in the next chat as a recall; a skip comes back as owed", () => {
  const { on, ctx, ledger, walk } = project();
  on("s1", "UserPromptSubmit", { prompt: "add a cap to applyDiscount in src/a.ts" });
  on("s1", "PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: { q: "src/a.ts applyDiscount" } },
  });
  on("s1", "Stop", { last_assistant_message: walk });
  const pass = ctx(on("s1", "UserPromptSubmit", { prompt: "it multiplies total by pct over 100" }));
  assert.match(pass, /Never say 'correct'/);
  assert.match(pass, /Now do|do the user's task/);
  // the next chat opens with Return: the recall, then the Commit question
  const open = ctx(
    on("s2", "UserPromptSubmit", { prompt: "add a floor to applyDiscount in src/a.ts" }),
  );
  assert.match(open, /From last time: in your own words, what does the code at src\/a\.ts:2 do\?/);
  const after = on("s2", "PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: { q: "it takes pct percent off the total" } },
  });
  assert.match(after.hookSpecificOutput.additionalContext, /Which part of the code do you expect/);
  assert.equal(ledger().find((l) => l.type === "recall").payload.result, "pass");
  // a later chat's task question is not asked twice in one chat: only one opening Return
  on("s2", "PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: { q: "Skip" } },
  });
  // the skip is owed, and the chat after brings it back small (X1)
  const s3 = ctx(on("s3", "UserPromptSubmit", { prompt: "add a log to src/a.ts" }));
  assert.match(
    s3,
    /Earlier you put this off: "Which part of the code do you expect this change to touch\?"/,
  );
});

test("a write skarp didn't see coming as a task gets the Commit question first", () => {
  const { on } = session();
  on("UserPromptSubmit", { prompt: "thanks" });
  const write = { tool_name: "Write", tool_input: { file_path: "/p/f.ts", content: "x" } };
  assert.match(
    on("PreToolUse", write).hookSpecificOutput.permissionDecisionReason,
    /Which part of the code do you expect this change to touch/,
  );
});

test("Hear: 'not sure' is a not-yet debt; a pasted walkthrough is a copied fill, not a new task", () => {
  const { on, ctx, ledger, dir, walk } = project();
  const write = { tool_name: "Write", tool_input: { file_path: `${dir}/src/a.ts`, content: "x" } };
  const start = (sid: string) => {
    on(sid, "UserPromptSubmit", { prompt: "add a cap to applyDiscount in src/a.ts" });
    on(sid, "PostToolUse", {
      tool_name: "AskUserQuestion",
      tool_response: { answers: { q: "src/a.ts" } },
    });
    on(sid, "Stop", { last_assistant_message: walk });
  };
  start("p1");
  const pasted = ctx(on("p1", "UserPromptSubmit", { prompt: walk }));
  assert.match(pasted, /another way/);
  assert.equal(
    ledger()
      .filter((l) => l.type === "ask")
      .at(-1).payload.block,
    "K8",
  );
  assert.deepEqual(ledger().find((l) => l.type === "hear_check").payload.fails, ["copied"]);
  start("p2");
  const unsure = ctx(on("p2", "UserPromptSubmit", { prompt: "not sure tbh" }));
  assert.match(unsure, /plain answer/);
  assert.equal(on("p2", "PreToolUse", write), undefined);
  const owed = ledger()
    .filter((l) => l.type === "owed")
    .at(-1);
  assert.equal(owed.payload.block, "K8");
  assert.equal(
    ledger()
      .filter((l) => l.type === "hear_check")
      .at(-1).payload.result,
    "not_yet",
  );
});

test("brainstorm: 'build it' before the decision starts the build once the decision is recorded", () => {
  const { on } = session();
  const ctx = (o: { hookSpecificOutput: { additionalContext: string } }) =>
    o.hookSpecificOutput.additionalContext;
  on("UserPromptSubmit", { prompt: "I have a rough idea: cache prices in memory" });
  on("UserPromptSubmit", { prompt: "or skip the cache at checkout" });
  on("UserPromptSubmit", { prompt: "done" });
  assert.match(ctx(on("UserPromptSubmit", { prompt: "build it" })), /Why|decide|options/);
  const built = ctx(
    on("UserPromptSubmit", {
      prompt: "I'm going with skipping the cache at checkout because the price must be fresh",
    }),
  );
  assert.match(built, /recorded the user's decision/);
  assert.match(built, /## skarp: where you stand/);
});
