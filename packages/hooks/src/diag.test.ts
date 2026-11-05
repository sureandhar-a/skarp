import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { diag, logDir, scrub, telemetryFile, usefulTelemetry } from "./diag.ts";
import { type HookInput, normalize, run } from "./hook.ts";
import { masker, readAlwaysMask, reportFile, writeReport } from "./mask.ts";

const dir = () => mkdtempSync(join(tmpdir(), "skarp-log-"));
const today = () => new Date().toISOString().slice(0, 10);
const lines = (home: string) =>
  readFileSync(join(logDir(home), `${today()}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const claude = (home: string, event: string, extra: object = {}) =>
  run(
    normalize({
      session_id: "s1",
      cwd: "/work/acme-shop",
      permission_mode: "default",
      hook_event_name: event,
      ...extra,
    }),
    home,
  ) as Record<string, unknown> | undefined;

test("keys and tokens never reach the disk", () => {
  const home = dir();
  for (const secret of [
    "sk-live-9f3kd02kslq",
    "ghp_abcdefghijklmnop1234",
    "AKIAIOSFODNN7EXAMPLE",
    "eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJ",
  ])
    assert.ok(!scrub(`the key is ${secret} ok`).includes(secret), secret);
  assert.equal(scrub("Authorization: Bearer abcdefghijklmnop"), "Authorization: Bearer [secret]");
  assert.equal(scrub("password=hunter2 next"), "password=[secret] next");
  diag(home, "x", { text: "api_key: abc123" });
  assert.ok(!readFileSync(join(logDir(home), `${today()}.jsonl`), "utf8").includes("abc123"));
});

test("a long text is cut with its length noted", () => {
  const home = dir();
  diag(home, "x", { text: "a".repeat(40_000) });
  const [l] = lines(home);
  assert.ok(l.text.length < 33_000);
  assert.match(l.text, /cut, 40000 chars/);
});

test("the log can be turned off", () => {
  const home = dir();
  writeFileSync(join(home, "config.json"), '{"log":false}');
  diag(home, "x", {});
  assert.ok(!existsSync(logDir(home)));
});

test("a failed write doesn't throw, and the next write says how many were lost", () => {
  const home = dir();
  mkdirSync(logDir(home));
  mkdirSync(join(logDir(home), `${today()}.jsonl`)); // a folder where the file should be
  diag(home, "lost", {});
  assert.equal(statSync(join(logDir(home), "lost")).size, 1);
  const other = join(logDir(home), `${today()}.jsonl`);
  // the folder goes, the next line lands with the count
  rmDir(other);
  diag(home, "ok", {});
  const ls = lines(home);
  assert.equal(ls[0].event, "lost_lines");
  assert.equal(ls[0].count, 1);
  assert.equal(ls[1].event, "ok");
});
const rmDir = (p: string) => rmSync(p, { recursive: true });

test("a new day removes old days, keeps flagged ones longer, and respects the size cap", () => {
  const home = dir();
  mkdirSync(logDir(home));
  const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const put = (n: number, text: string) => {
    writeFileSync(join(logDir(home), `${ago(n)}.jsonl`), text);
    return ago(n);
  };
  const old = put(20, '{"event":"hook"}\n');
  const flagged = put(21, '{"event":"flag"}\n');
  const ancient = put(40, '{"event":"flag"}\n');
  const recent = put(3, "x".repeat(10));
  diag(home, "x", {});
  const left = readdirSync(logDir(home));
  assert.ok(!left.includes(`${old}.jsonl`));
  assert.ok(left.includes(`${flagged}.jsonl`));
  assert.ok(!left.includes(`${ancient}.jsonl`));
  assert.ok(left.includes(`${recent}.jsonl`));

  const big = dir();
  mkdirSync(logDir(big));
  for (const n of [5, 4, 3])
    writeFileSync(join(logDir(big), `${ago(n)}.jsonl`), "x".repeat(20 * 1024 * 1024));
  diag(big, "x", {});
  const kept = readdirSync(logDir(big));
  assert.ok(!kept.includes(`${ago(5)}.jsonl`), "oldest goes first");
  assert.ok(kept.includes(`${ago(3)}.jsonl`));
});

test("a new day keeps a chat's telemetry, drops metrics and background calls, empties the file", () => {
  const home = dir();
  const file = telemetryFile(home);
  mkdirSync(join(home, "telemetry"));
  writeFileSync(
    file,
    [
      JSON.stringify({ resource: {}, scopeMetrics: [{ big: "x" }] }),
      JSON.stringify({ body: "chat bg", attributes: { "gen_ai.response.model": "mini" } }),
      JSON.stringify({
        body: "invoke_agent",
        hrTime: [1_800_000_000, 0],
        resource: { huge: "y" },
        attributes: {
          "gen_ai.conversation.id": "s1",
          "gen_ai.response.model": "gpt-6-luna",
          other: "dropped",
        },
      }),
    ].join("\n"),
  );
  diag(home, "x", {});
  const t = lines(home).filter((l) => l.event === "telemetry");
  assert.equal(t.length, 1);
  assert.equal(t[0].session, "s1");
  assert.equal(t[0].attrs["gen_ai.response.model"], "gpt-6-luna");
  assert.equal(t[0].attrs.other, undefined);
  assert.equal(statSync(file).size, 0);
  assert.equal(usefulTelemetry("not json\n").length, 0);
});

test("every hook call is logged: rules fired, state moved, skarp's answer, the time it took", () => {
  const home = dir();
  claude(home, "UserPromptSubmit", { prompt: "add the tax value" });
  const ls = lines(home);
  assert.equal(ls[0].event, "session");
  assert.equal(ls[0].surface, "claude-code");
  const hook = ls.find((l) => l.event === "hook");
  assert.equal(hook.prompt, "add the tax value");
  assert.equal(hook.rules.classify, "task");
  assert.equal(hook.after.asking, "A1");
  assert.ok(hook.output.hookSpecificOutput);
  assert.equal(typeof hook.ms, "number");
  assert.ok(
    ls.some((l) => l.event === "ask"),
    "the ledger's lines come along",
  );
});

test("a card is logged in full; another tool's contents stay out", () => {
  const home = dir();
  claude(home, "UserPromptSubmit", { prompt: "add the tax value" });
  const questions = [{ question: "Your view?", options: [{ label: "Skip" }] }];
  claude(home, "PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions } });
  claude(home, "PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_input: { questions },
    tool_response: { answers: { "Your view?": "the raw answer" } },
  });
  claude(home, "PreToolUse", {
    tool_name: "Write",
    tool_input: { file_path: "/p/a.ts", content: "SECRET_FILE_BODY" },
  });
  claude(home, "PostToolUse", {
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { stdout: "COMMAND_OUTPUT", exit_code: 1 },
  });
  const raw = readFileSync(join(logDir(home), `${today()}.jsonl`), "utf8");
  assert.ok(raw.includes("the raw answer"));
  assert.ok(raw.includes("Your view?"));
  assert.ok(raw.includes("/p/a.ts"));
  assert.ok(!raw.includes("SECRET_FILE_BODY"));
  assert.ok(!raw.includes("COMMAND_OUTPUT"));
});

test("Stop says where the reply came from, or why there was none", () => {
  const replyOf = (extra: object) => {
    const home = dir();
    claude(home, "Stop", extra);
    return lines(home).find((l) => l.event === "hook").reply;
  };
  assert.equal(replyOf({ last_assistant_message: "hi" }).source, "hook field");
  assert.deepEqual([replyOf({}).source, replyOf({}).transcript], ["none", "not given"]);
  assert.equal(replyOf({ transcript_path: "/no/such" }).transcript, "unreadable");
  const home = dir();
  const t = join(home, "t.jsonl");
  writeFileSync(
    t,
    `${JSON.stringify({ message: { role: "assistant", model: "m1", content: [{ type: "text", text: "## A\nbody" }] } })}\n`,
  );
  const r = replyOf({ transcript_path: t });
  assert.deepEqual(
    [r.source, r.transcript, r.model, r.headings],
    ["transcript", "read", "m1", ["## A"]],
  );
});

test("a crash is recorded and the agent carries on", () => {
  const home = dir();
  const bad = {
    session_id: "s1",
    hook_event_name: "UserPromptSubmit",
    get prompt(): string {
      throw new Error("boom");
    },
  } as HookInput;
  assert.doesNotThrow(() => run(bad, home));
  assert.ok(lines(home).some((l) => l.event === "hook_crash"));
});

test("logging adds little to a hook call", () => {
  const home = dir();
  diag(home, "first", {}); // the day's clean-up is measured elsewhere
  const start = performance.now();
  for (let i = 0; i < 200; i++) diag(home, "hook", { session: "s1", prompt: "add the tax value" });
  assert.ok((performance.now() - start) / 200 < 5, "under 5 ms a line");
});

// /flag: never a task, an answer or a skip
test("/flag with text is saved, blocked from the AI, and changes nothing else", () => {
  const home = dir();
  const out = claude(home, "UserPromptSubmit", { prompt: "/flag the card text is faint" });
  assert.equal(out?.decision, "block");
  assert.match(String(out?.reason), /saved your flag/);
  const flag = lines(home).find((l) => l.event === "flag");
  assert.equal(flag.text, "the card text is faint");
  assert.ok(!lines(home).some((l) => l.event === "user_message"));
  assert.ok(existsSync(reportFile(home)));
});

test("/flag alone asks, and the next message is the note, on either command name", () => {
  const home = dir();
  const out = claude(home, "UserPromptSubmit", { prompt: "/skarp:flag" });
  assert.match(String(out?.reason), /What went wrong/);
  assert.equal(lines(home).filter((l) => l.event === "flag").length, 0);
  const next = claude(home, "UserPromptSubmit", { prompt: "it restarted Hear" });
  assert.equal(next?.decision, "block");
  assert.equal(lines(home).find((l) => l.event === "flag").text, "it restarted Hear");
  const after = claude(home, "UserPromptSubmit", { prompt: "add the tax value" });
  assert.notEqual(after?.decision, "block");
});

test("/flag while skarp's question waits leaves the question waiting", () => {
  const home = dir();
  claude(home, "UserPromptSubmit", { prompt: "add the tax value" });
  const out = claude(home, "UserPromptSubmit", { prompt: "/flag the card is faint" });
  assert.match(String(out?.reason), /still waiting/);
  assert.ok(!lines(home).some((l) => l.event === "answer"));
  assert.equal(
    lines(home)
      .filter((l) => l.event === "hook")
      .at(-1).after.asking,
    "A1",
  );
});

test("/flag typed into a card is a flag, and the question is asked again", () => {
  const home = dir();
  claude(home, "UserPromptSubmit", { prompt: "add the tax value" });
  const out = claude(home, "PostToolUse", {
    tool_name: "AskUserQuestion",
    tool_response: { answers: { q: "/flag faint text" } },
  });
  assert.match(String(out?.additionalContext), /ask the question again/);
  assert.ok(!lines(home).some((l) => l.event === "answer"));
  assert.equal(lines(home).filter((l) => l.event === "flag")[0].text, "faint text");
});

test("in a flag's turn (Copilot) the AI gets no tools and Stop owes nothing", () => {
  const home = dir();
  claude(home, "UserPromptSubmit", { prompt: "add the tax value" });
  claude(home, "UserPromptSubmit", { prompt: "/flag faint" });
  const denied = claude(home, "PreToolUse", { tool_name: "Read", tool_input: { file_path: "a" } });
  assert.equal(denied?.permissionDecision, "deny");
  assert.equal(claude(home, "Stop", { last_assistant_message: "Flagged." }), undefined);
  const next = claude(home, "Stop", { last_assistant_message: "Hello" });
  assert.equal(next?.decision, "block", "the normal rules are back");
});

// the report
const planted = [
  "We need to fix the invoice export for Apple before Friday.",
  "ask Priya Raman to review, Karthik already approved it",
  "Northwind is on the old plan",
  "zentrix portal returns a 500 when the session expires",
  "deploy to billing-prod-03.corp.local then restart",
  "the bug is in /work/acme-shop/src/cart.ts at line 88",
  "CartService.applyTax rounds down, see PAY-2291",
  "mail dan.smith@acme.example about the outage",
  "the discount was 18% on the $4,200 renewal",
  "our internal tool quickbill calls ledgerd",
];
const secret =
  /Priya|Raman|Karthik|Northwind|zentrix|billing-prod|acme|cart\.ts|CartService|applyTax|PAY-2291|dan\.smith|4,200|18%|quickbill|ledgerd/i;

test("masking hides names, paths and numbers, keeps ordinary words, and uses stable placeholders", () => {
  const home = dir();
  const m = masker(home);
  for (const p of planted) assert.doesNotMatch(m.text(p), secret, p);
  assert.equal(m.text("add the tax value"), "add the tax value");
  assert.equal(m.text("give me an overview"), "give me an overview");
  assert.match(m.text("```js\nconst a = 1;\nb();\n```"), /^\[code: 2 lines\]$/);
  const once = m.text("zentrix");
  m.save();
  assert.equal(masker(home).text("Zentrix"), once, "the same across reports");
  assert.equal(masker(home).lookup(once), "zentrix");
});

test("the always-mask list hides names that are also common words", () => {
  const home = dir();
  assert.match(masker(home).text("the client apple"), /apple/);
  writeFileSync(join(home, "always-mask.txt"), "Apple\nShell Oil\n");
  assert.deepEqual(readAlwaysMask(home), ["Apple", "Shell Oil"]);
  const t = masker(home).text("the client apple and Shell Oil");
  assert.doesNotMatch(t, /apple|shell/i);
});

test("the report is masked throughout, warns while the list is empty, and leaves the log alone", () => {
  const home = dir();
  claude(home, "UserPromptSubmit", { prompt: "add CartService tax for zentrix" });
  claude(home, "PreToolUse", {
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question: "zentrix or quickbill?" }] },
  });
  claude(home, "Stop", { last_assistant_message: "See /work/acme-shop/cart.ts" });
  claude(home, "UserPromptSubmit", { prompt: "/flag quickbill card is faint" });
  const before = readFileSync(join(logDir(home), `${today()}.jsonl`), "utf8");
  const r = writeReport(home);
  const md = readFileSync(r.path, "utf8");
  assert.doesNotMatch(md, secret);
  assert.doesNotMatch(md, /s1\b/, "the session id is a placeholder too");
  assert.match(md, /Read this file before you share it/);
  assert.match(md, /always-mask list is empty/);
  assert.match(md, /## Your flags\n\n- .* card is /);
  assert.equal(r.flags, 1);
  assert.equal(statSync(r.path).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(logDir(home), `${today()}.jsonl`), "utf8"), before);
  assert.match(before, /zentrix/, "the private log keeps the full text");
});

test("by default a report has the last session and flagged ones, not everything", () => {
  const home = dir();
  const say = (session_id: string, prompt: string) =>
    run(normalize({ session_id, cwd: "/p", hook_event_name: "UserPromptSubmit", prompt }), home);
  say("old", "hello there");
  say("flagged", "/flag something");
  say("last", "hello again");
  const md = (o = {}) => {
    writeReport(home, o);
    return readFileSync(reportFile(home), "utf8");
  };
  assert.ok(!md().includes("hello there"));
  assert.ok(md().includes("hello again"));
  assert.ok(md({ all: true }).includes("hello there"));
  assert.ok(!md({ session: "last" }).includes("something"));
});

test("the report names the model when telemetry or the transcript does", () => {
  const home = dir();
  mkdirSync(join(home, "telemetry"));
  writeFileSync(
    telemetryFile(home),
    JSON.stringify({
      body: "invoke_agent",
      attributes: { "gen_ai.conversation.id": "s1", "gen_ai.response.model": "gpt-6-luna" },
    }),
  );
  diag(home, "first", {}); // moves that telemetry into the log
  claude(home, "UserPromptSubmit", { prompt: "hello there" });
  assert.match(readFileSync(writeReport(home).path, "utf8"), /models: gpt-6-luna/);
});
