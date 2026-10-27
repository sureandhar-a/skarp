import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hooksFile, nodeOk, paths, remove, setup, status } from "./skarp.mjs";

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
