import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hooksFile, log, nodeOk, paths, remove, report, setup, status } from "./skarp.mjs";

const dirs = () => ({
  home: mkdtempSync(join(tmpdir(), "skarp-home-")),
  cwd: mkdtempSync(join(tmpdir(), "skarp-proj-")),
});
const quiet = () => {
  const lines = [];
  return { out: (l) => lines.push(l), lines };
};

test("setup copies the hook and writes one valid user-level Copilot hooks file; again is the same", () => {
  const d = dirs();
  const q = quiet();
  assert.equal(setup({ ...d, out: q.out }), 0);
  const p = paths(d.home, d.cwd);
  assert.ok(existsSync(p.hook));
  const file = JSON.parse(readFileSync(p.userHooks, "utf8"));
  assert.equal(file.version, 1);
  assert.match(file.hooks.agentStop[0].command, /hook\.mjs" Stop$/);
  assert.match(file.hooks.userPromptSubmitted[0].command, /UserPromptSubmit$/);
  assert.ok(!existsSync(p.projectHooks));
  setup({ ...d, out: quiet().out });
  assert.deepEqual(JSON.parse(readFileSync(p.userHooks, "utf8")), file);
});

test("setup --project writes project hooks and merges VS Code settings, keeping the user's", () => {
  const d = dirs();
  const p = paths(d.home, d.cwd);
  mkdirSync(join(d.cwd, ".vscode"));
  writeFileSync(p.vscodeSettings, JSON.stringify({ "editor.tabSize": 2 }));
  setup({ ...d, project: true, out: quiet().out });
  const settings = JSON.parse(readFileSync(p.vscodeSettings, "utf8"));
  assert.equal(settings["editor.tabSize"], 2);
  assert.equal(settings["chat.useHooks"], true);
  assert.ok(existsSync(p.projectHooks));
  assert.ok(!existsSync(p.userHooks));
});

test("setup leaves a settings file with comments alone and says what to add", () => {
  const d = dirs();
  const p = paths(d.home, d.cwd);
  mkdirSync(join(d.cwd, ".vscode"));
  writeFileSync(p.vscodeSettings, '{ // mine\n "a": 1 }');
  const q = quiet();
  setup({ ...d, project: true, out: q.out });
  assert.equal(readFileSync(p.vscodeSettings, "utf8"), '{ // mine\n "a": 1 }');
  assert.ok(q.lines.some((l) => l.includes("chat.useHooks")));
});

test("status reads the ledger without printing what anyone wrote; remove deletes only skarp's files", () => {
  const d = dirs();
  setup({ ...d, out: quiet().out });
  const p = paths(d.home, d.cwd);
  mkdirSync(join(p.skarp, "ledger"), { recursive: true });
  const line = (type, payload) =>
    JSON.stringify({ time: "t", type, session_id: "s", payload: { task_id: "k", ...payload } });
  writeFileSync(
    p.ledger,
    [
      line("seen", { event: "Stop", fields: ["sessionId", "transcriptPath"] }),
      line("ask", { block: "A1" }),
      line("answer", { text: "my private plan" }),
      line("report", { path: "/x.md" }),
      line("recall", { fact: "src/a.ts:2", result: "pass" }),
      line("hear", { fixes: [] }),
      line("hear_check", { result: "miss", round: 0, fact: "src/a.ts:2", text: "my private fill" }),
      line("understand_check", { part: "Picker", result: "miss", round: 0, text: "private one" }),
      line("understand_check", {
        part: "Picker",
        result: "pass",
        fact: "src/p.ts:3",
        text: "private two",
      }),
      line("understand_check", { part: "Apply", result: "not_yet" }),
      line("shelf", { parts: ["Config"] }),
    ].join("\n"),
  );
  const q = quiet();
  status({ ...d, out: q.out });
  const text = q.lines.join("\n");
  assert.match(text, /asked ✓ {2}answered ✓ {2}report saved ✓/);
  assert.match(text, /Stop fields: sessionId, transcriptPath/);
  assert.doesNotMatch(text, /my private plan/);
  assert.match(text, /✓ walkthrough: given/);
  assert.match(text, /✗ fill: missed, explained another way \(src\/a\.ts:2\)/);
  assert.match(text, /✓ recall: matched \(src\/a\.ts:2\)/);
  assert.doesNotMatch(text, /my private fill/);
  assert.match(text, /✓ part Picker: matched the code at src\/p\.ts:3/);
  assert.match(text, /- part Apply: not yet \(kept as owed\)/);
  assert.match(text, /on the Shelf: Config/);
  assert.doesNotMatch(text, /private (one|two)/);
  remove({ ...d, out: quiet().out });
  assert.ok(!existsSync(p.userHooks));
  assert.ok(!existsSync(p.hook));
  assert.ok(existsSync(p.ledger)); // records stay without --all
});

test("Node version check and the hooks file shape", () => {
  assert.equal(nodeOk("24.2.0"), true);
  assert.equal(nodeOk("24.1.9"), false);
  assert.equal(nodeOk("26.0.0"), true);
  assert.equal(Object.keys(hooksFile("/h.mjs").hooks).length, 6);
});

test("setup adds /flag, asks before telemetry, and remove undoes both", () => {
  const d = dirs();
  const p = paths(d.home, d.cwd);
  setup({ ...d, ask: () => "n", out: quiet().out });
  assert.ok(existsSync(p.flagPrompt));
  assert.ok(!existsSync(p.userSettings), "no answer yes, no settings touched");
  writeFileSync(p.userSettings, '{"editor.fontSize":14}');
  setup({ ...d, ask: () => "y", out: quiet().out });
  const on = JSON.parse(readFileSync(p.userSettings, "utf8"));
  assert.equal(on["editor.fontSize"], 14);
  assert.equal(on["github.copilot.chat.otel.exporterType"], "file");
  assert.equal(on["github.copilot.chat.otel.captureContent"], false);
  assert.equal(on["github.copilot.chat.otel.outfile"], p.telemetry);
  remove({ ...d, out: quiet().out });
  assert.deepEqual(JSON.parse(readFileSync(p.userSettings, "utf8")), { "editor.fontSize": 14 });
  assert.ok(!existsSync(p.flagPrompt));
});

test("setup won't rewrite a settings file with comments", () => {
  const d = dirs();
  const p = paths(d.home, d.cwd);
  mkdirSync(join(p.userSettings, ".."), { recursive: true });
  writeFileSync(p.userSettings, "// mine\n{}");
  const q = quiet();
  setup({ ...d, telemetry: true, ask: () => "", out: q.out });
  assert.equal(readFileSync(p.userSettings, "utf8"), "// mine\n{}");
  assert.ok(q.lines.some((l) => l.includes("has comments")));
});

test("report asks for names and the problem, writes one masked file, and sends nothing", async () => {
  const d = dirs();
  const p = paths(d.home, d.cwd);
  const answers = ["Northwind, Apple", "the card for Northwind was wrong"];
  const q = quiet();
  assert.equal(await report({ ...d, ask: () => answers.shift(), out: q.out }), 0);
  assert.match(readFileSync(p.alwaysMask, "utf8"), /Northwind\nApple/);
  const file = join(p.skarp, "shared", "skarp-report.md");
  const md = readFileSync(file, "utf8");
  assert.match(md, /card for name-\d+ was wrong/);
  assert.doesNotMatch(md, /Northwind/);
  assert.ok(q.lines.some((l) => l.includes(file)));
  assert.ok(q.lines.some((l) => l.includes("Read the file")));
  const look = quiet();
  assert.equal(await report({ ...d, lookup: "name-1", out: look.out }), 0);
  assert.equal(look.lines[0], "northwind");
});

test("log off and on are remembered, and status says so", () => {
  const d = dirs();
  const p = paths(d.home, d.cwd);
  assert.equal(log({ ...d, state: "maybe", out: quiet().out }), 1);
  log({ ...d, state: "off", out: quiet().out });
  assert.deepEqual(JSON.parse(readFileSync(p.config, "utf8")), { log: false });
  const q = quiet();
  status({ ...d, out: q.out });
  assert.ok(q.lines.includes("- diagnostic log: off"));
  log({ ...d, state: "on", out: quiet().out });
  const r = quiet();
  status({ ...d, out: r.out });
  assert.ok(r.lines.some((l) => l.startsWith("✓ diagnostic log: on")));
});
