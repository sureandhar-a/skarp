#!/usr/bin/env node
// skarp's installer for GitHub Copilot: `npx skarp-copilot setup | status | remove`. No dependencies.
// It copies the bundled hook to ~/.skarp/bin and points Copilot's user-level hooks file at it, so
// one setup covers every project. Nothing here sends anything anywhere.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
// the events skarp listens to: Copilot's camelCase name, and the name passed to the hook
const EVENTS = [
  ["sessionStart", "SessionStart"],
  ["userPromptSubmitted", "UserPromptSubmit"],
  ["preToolUse", "PreToolUse"],
  ["postToolUse", "PostToolUse"],
  ["postToolUseFailure", "PostToolUseFailure"],
  ["agentStop", "Stop"],
];
const MIN_NODE = [24, 2];

export function paths(home = homedir(), cwd = process.cwd()) {
  const skarp = process.env.SKARP_HOME ?? join(home, ".skarp");
  const copilot = process.env.COPILOT_HOME ?? join(home, ".copilot");
  return {
    skarp,
    hook: join(skarp, "bin", "hook.mjs"),
    version: join(skarp, "bin", "version"),
    userHooks: join(copilot, "hooks", "skarp.json"),
    projectHooks: join(cwd, ".github", "hooks", "skarp.json"),
    vscodeSettings: join(cwd, ".vscode", "settings.json"),
    ledger: join(skarp, "ledger", "hooks.jsonl"),
  };
}

export const nodeOk = (v = process.versions.node) => {
  const [a = 0, b = 0] = v.split(".").map(Number);
  return a > MIN_NODE[0] || (a === MIN_NODE[0] && b >= MIN_NODE[1]);
};

// Copilot's hook file: version 1, camelCase events, one command each. The quotes keep paths
// with spaces working on macOS, Linux and Windows.
export function hooksFile(hook) {
  return {
    version: 1,
    hooks: Object.fromEntries(
      EVENTS.map(([copilot, ours]) => [
        copilot,
        [{ type: "command", command: `node "${hook}" ${ours}` }],
      ]),
    ),
  };
}

const writeJson = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

export function setup({ home, cwd, project = false, out = console.log } = {}) {
  const p = paths(home, cwd);
  if (!nodeOk()) {
    // Copilot blocks every tool when a hook can't start, so a too-old Node installs nothing
    out(`skarp needs Node ${MIN_NODE.join(".")} or newer; this is ${process.versions.node}.`);
    out("Nothing was installed. Update Node, then run `npx skarp-copilot setup` again.");
    return 1;
  }
  mkdirSync(dirname(p.hook), { recursive: true, mode: 0o700 });
  copyFileSync(join(here, "..", "hook.mjs"), p.hook);
  writeFileSync(p.version, `${VERSION}\n`);
  out(`✓ hook copied to ${p.hook}`);
  if (project) {
    // VS Code's older Local runtime reads hooks from the project and needs them switched on
    writeJson(p.projectHooks, hooksFile(p.hook));
    out(`✓ project hooks written to ${p.projectHooks}`);
    const want = { "chat.useHooks": true, "chat.askQuestions.enabled": true };
    if (!existsSync(p.vscodeSettings)) {
      writeJson(p.vscodeSettings, want);
      out(`✓ hooks switched on in ${p.vscodeSettings}`);
    } else {
      try {
        const cur = JSON.parse(readFileSync(p.vscodeSettings, "utf8"));
        writeJson(p.vscodeSettings, { ...cur, ...want });
        out(`✓ hooks switched on in ${p.vscodeSettings} (your other settings kept)`);
      } catch {
        // comments or trailing commas: don't risk the user's file
        out(`! ${p.vscodeSettings} has comments, so skarp left it alone. Add these two lines:`);
        out('  "chat.useHooks": true, "chat.askQuestions.enabled": true');
      }
    }
  } else {
    writeJson(p.userHooks, hooksFile(p.hook));
    out(`✓ Copilot hooks written to ${p.userHooks} (all projects)`);
  }
  if (existsSync(p.userHooks) && existsSync(p.projectHooks))
    out(
      "! Both user and project hooks exist; skarp may run twice. Remove one with `npx skarp-copilot remove`.",
    );
  out(
    `skarp ${VERSION} is set up. Open Copilot Chat and send: create hello.js that prints hello world`,
  );
  out("You should see skarp's question first. Then run `npx skarp-copilot status`.");
  return 0;
}

const readLines = (file) => {
  try {
    return readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

const validHooks = (file) => {
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    return d.version === 1 && typeof d.hooks === "object";
  } catch {
    return false;
  }
};

// A plain summary you can read off the screen: what is installed, and whether the last piece of
// work went through each step. Field names and yes/no only, never what you or the AI wrote.
export function status({ home, cwd, out = console.log } = {}) {
  const p = paths(home, cwd);
  const mark = (ok) => (ok ? "✓" : "✗");
  out(`skarp ${existsSync(p.version) ? readFileSync(p.version, "utf8").trim() : "(not set up)"}`);
  out(`${mark(nodeOk())} Node ${process.versions.node} (needs ${MIN_NODE.join(".")}+)`);
  out(`${mark(existsSync(p.hook))} hook at ${p.hook}`);
  for (const [name, file] of [
    ["user hooks", p.userHooks],
    ["project hooks", p.projectHooks],
  ])
    if (existsSync(file)) out(`${mark(validHooks(file))} ${name}: ${file}`);
  if (!existsSync(p.userHooks) && !existsSync(p.projectHooks))
    out("✗ no hooks file: run `npx skarp-copilot setup`");
  const lines = readLines(p.ledger);
  if (!lines.length) {
    out(
      "✗ nothing logged yet: hooks haven't run. Send a message in Copilot Chat, then check again.",
    );
    return 0;
  }
  const last = lines.at(-1);
  out(`✓ last event ${last.time}`);
  const session = lines.filter((l) => l.session_id === last.session_id);
  const seen = session.filter((l) => l.type === "seen");
  out(`  events seen: ${seen.map((l) => l.payload.event).join(", ") || "none"}`);
  const task = [...session].reverse().find((l) => l.payload?.task_id)?.payload.task_id;
  if (task) {
    const t = session.filter((l) => l.payload?.task_id === task);
    const has = (type) => t.some((l) => l.type === type);
    out(
      `  last work: asked ${mark(has("ask"))}  answered ${mark(has("answer") || has("answer_skipped"))}  report saved ${mark(has("report"))}  brainstorm saved ${mark(has("brainstorm"))}`,
    );
    const ref = t.filter((l) => l.type === "referee").at(-1);
    if (ref?.payload.not_run) out(`  report check: not run (${ref.payload.not_run})`);
    else if (ref) {
      const { shape = [], failed = [], fixes = [] } = ref.payload;
      const n = shape.length + failed.length + fixes.length;
      out(
        `  ${mark(!n)} last ${ref.payload.check} check: ${n ? `${n} to fix${failed.length ? ` (${failed.join(", ")})` : ""}` : "passed"}`,
      );
    }
    // Hear: the walkthrough and the fill's check, as results only; never the fill's words
    const hear = t.filter((l) => l.type === "hear").at(-1);
    const fill = t.filter((l) => l.type === "hear_check").at(-1);
    const quietHear = t.some((l) => l.type === "silence" && l.payload.intent === "hear");
    if (quietHear) out("  walkthrough: not needed (you've shown this area before)");
    else if (hear || fill) {
      const fixes = hear?.payload.fixes ?? [];
      const given = fill || (hear && !hear.payload.not_run && !fixes.length);
      out(
        `  ${mark(Boolean(given))} walkthrough: ${given ? "given" : hear.payload.not_run ? `not checked (${hear.payload.not_run})` : `${fixes.length} to fix`}`,
      );
      const r = fill?.payload;
      if (!r) out("  fill: waiting for your answer");
      else if (r.result === "pass") out(`  ✓ fill: matched the code at ${r.fact}`);
      else if (r.result === "not_yet") out("  fill: not yet (kept as owed)");
      else
        out(
          `  ✗ fill: missed${r.round >= 1 ? ", plain answer given" : ", explained another way"} (${r.fact})`,
        );
    }
    // understand: each part and what its check came to, the last line per part; never the fill
    const checks = new Map();
    for (const l of t.filter((l) => l.type === "understand_check")) checks.set(l.payload.part, l);
    for (const [part, l] of checks) {
      const r = l.payload;
      const said = r.not_run
        ? ["-", "answered, not checked (the cited line can't be read)"]
        : ({
            pass: ["✓", `matched the code at ${r.fact}`],
            miss: [
              "✗",
              r.round >= 1 ? "missed, plain answer given" : "missed, explained another way",
            ],
            not_yet: ["-", "not yet (kept as owed)"],
            unclear: ["-", "still unclear (kept as owed)"],
          }[r.result] ?? ["-", r.result]);
      out(`  ${said[0]} part ${part}: ${said[1]}`);
    }
    const shelf = t.filter((l) => l.type === "shelf").at(-1);
    if (shelf) out(`  on the Shelf: ${shelf.payload.parts.join(", ")}`);
    // the opening Return: a recall of an earlier fill, or a question put off before
    const recall = t.filter((l) => l.type === "recall").at(-1);
    if (recall)
      out(
        `  ${recall.payload.result === "skipped" ? "-" : mark(recall.payload.result === "pass")} recall: ${{ pass: "matched", miss: "missed", skipped: "skipped" }[recall.payload.result]} (${recall.payload.fact})`,
      );
    const owed = t.filter((l) => l.payload?.block === "X1").at(-1);
    if (owed)
      out(`  owed question from before: ${owed.type === "answer" ? "answered" : "skipped"}`);
    // skarp's own grade wording; it names files, never what you wrote
    const grade = t.filter((l) => l.type === "outcome").at(-1);
    if (grade?.payload.text) out(`  grade: ${grade.payload.text.replace(/^skarp: /, "")}`);
  }
  for (const l of seen) out(`  ${l.payload.event} fields: ${l.payload.fields.join(", ")}`);
  return 0;
}

export function remove({ home, cwd, all = false, out = console.log } = {}) {
  const p = paths(home, cwd);
  for (const f of [p.userHooks, p.projectHooks, dirname(p.hook)])
    if (existsSync(f)) {
      rmSync(f, { recursive: true, force: true });
      out(`✓ removed ${f}`);
    }
  if (all && existsSync(p.skarp)) {
    rmSync(p.skarp, { recursive: true, force: true });
    out(`✓ removed ${p.skarp} (your ledger, reports and brainstorms)`);
  } else if (existsSync(p.skarp))
    out(`Your records stay in ${p.skarp}; add --all to delete them too.`);
  out("If you added hooks to .vscode/settings.json, you can remove those two lines.");
  return 0;
}

// npx runs the bin through a link, so compare real paths
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const [cmd, ...flags] = process.argv.slice(2);
  const opts = { project: flags.includes("--project"), all: flags.includes("--all") };
  const run = { setup, status, remove }[cmd ?? ""];
  if (!run) {
    console.log(
      `skarp ${VERSION}\nUsage: npx skarp-copilot setup [--project] | status | remove [--all]`,
    );
    process.exit(cmd ? 1 : 0);
  }
  process.exit(run(opts));
}
