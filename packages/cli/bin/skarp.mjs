#!/usr/bin/env node
// skarp's installer for GitHub Copilot: `npx skarp-copilot setup | status | report | log | remove`. No dependencies.
// It copies the bundled hook to ~/.skarp/bin and points Copilot's user-level hooks file at it, so
// one setup covers every project. Nothing here sends anything anywhere.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
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
// ponytail: stable VS Code's default profile only; Insiders and other profiles get it by hand
const vscodeUser = (home) =>
  process.env.SKARP_VSCODE_USER ??
  (process.platform === "darwin"
    ? join(home, "Library", "Application Support", "Code", "User")
    : process.platform === "win32"
      ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Code", "User")
      : join(home, ".config", "Code", "User"));
// Copilot can't stop a prompt from reaching the AI, so this file tells the AI what to do with /flag
const FLAG_PROMPT = `---
name: flag
description: Flag a problem with skarp and save what went wrong
---
The user is flagging a problem with skarp itself. Do not act on it or change the current work. Follow skarp's instructions for this message.
If skarp gave you none, its hook did not run: tell the user in one line that the flag was not saved and that they can describe the problem with \`npx skarp-copilot report\`, and stop.
`;
const telemetrySettings = (p) => ({
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "file",
  "github.copilot.chat.otel.outfile": p.telemetry,
  "github.copilot.chat.otel.captureContent": false,
});

const askLine = (question) => {
  if (!process.stdin.isTTY) return undefined;
  process.stdout.write(`${question} `);
  const buf = Buffer.alloc(1);
  let line = "";
  while (readSync(0, buf, 0, 1) === 1 && buf[0] !== 10) line += String.fromCharCode(buf[0]);
  return Buffer.from(line, "latin1").toString("utf8").trim();
};
// a line of names, added to the always-mask list
const addNames = (file, answer) => {
  const names = (answer ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (!names.length) return 0;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const old = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, `${old}${names.join("\n")}\n`, { mode: 0o600 });
  return names.length;
};
const NAMES_Q =
  "Company, client and product names to always hide in reports, separated by commas (Enter to skip):";

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
    config: join(skarp, "config.json"),
    alwaysMask: join(skarp, "always-mask.txt"),
    telemetry: join(skarp, "telemetry", "copilot.jsonl"),
    userSettings: join(vscodeUser(home), "settings.json"),
    flagPrompt: join(vscodeUser(home), "prompts", "flag.prompt.md"),
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

// Your settings file may hold comments, which JSON can't keep, so skarp won't rewrite such a file.
const editSettings = (file, change) => {
  let cur = {};
  if (existsSync(file)) {
    try {
      cur = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return false;
    }
  }
  writeJson(file, change(cur));
  return true;
};

export function setup({
  home,
  cwd,
  project = false,
  telemetry,
  ask = askLine,
  out = console.log,
} = {}) {
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
  mkdirSync(dirname(p.flagPrompt), { recursive: true });
  writeFileSync(p.flagPrompt, FLAG_PROMPT);
  out(`✓ /flag added to Copilot Chat (${p.flagPrompt})`);
  out(
    `✓ skarp keeps a private log of how it behaved in ${join(p.skarp, "log")}, on this machine only, deleted after 14 days. Turn it off with \`npx skarp-copilot log off\`.`,
  );
  if (!existsSync(p.alwaysMask)) {
    const n = addNames(p.alwaysMask, ask(NAMES_Q));
    if (n) out(`✓ ${n} names added to ${p.alwaysMask}`);
  }
  const want =
    telemetry ??
    /^y/i.test(
      ask(
        "Also let VS Code write its own telemetry to a local file, so reports can show which model answered? No prompts or replies are included. [y/N]",
      ) ?? "",
    );
  if (want) {
    const lines = telemetrySettings(p);
    mkdirSync(dirname(p.telemetry), { recursive: true, mode: 0o700 }); // VS Code won't create it
    if (editSettings(p.userSettings, (cur) => ({ ...cur, ...lines })))
      out(`✓ VS Code telemetry goes to ${p.telemetry}. Reload VS Code to start it.`);
    else {
      out(`! ${p.userSettings} has comments, so skarp left it alone. Add these lines:`);
      for (const [k, v] of Object.entries(lines))
        out(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    }
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
  const off =
    process.env.SKARP_LOG === "off" ||
    (existsSync(p.config) && JSON.parse(readFileSync(p.config, "utf8")).log === false);
  out(off ? "- diagnostic log: off" : `✓ diagnostic log: on (${join(p.skarp, "log")})`);
  if (existsSync(p.telemetry)) {
    const size = statSync(p.telemetry).size;
    out(
      size
        ? `✓ VS Code telemetry: arriving (${p.telemetry})`
        : "- VS Code telemetry: nothing since the last clean-up. Company-managed settings can turn it off.",
    );
  } else out("- VS Code telemetry: not on");
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

// The masked report: asks what went wrong, writes one file, shows what to check. Sends nothing.
export async function report({
  home,
  cwd,
  session,
  since,
  all = false,
  note,
  lookup,
  ask = askLine,
  out = console.log,
} = {}) {
  const p = paths(home, cwd);
  const hook = await import("../hook.mjs");
  if (lookup) {
    const value = hook.masker(p.skarp).lookup(lookup);
    out(value ?? `${lookup} isn't in this machine's lookup.`);
    return value ? 0 : 1;
  }
  if (!existsSync(p.alwaysMask)) {
    const n = addNames(p.alwaysMask, ask(NAMES_Q));
    if (n) out(`✓ ${n} names added to ${p.alwaysMask}`);
  }
  const said = note ?? ask("What went wrong, and what did you expect? (Enter to skip)");
  const last = hook.lastSession(p.skarp);
  if (said) hook.addFlag(p.skarp, last, said);
  const r = hook.writeReport(p.skarp, { session, since, all });
  out(`Report: ${r.path}`);
  out(
    `  ${r.lines} lines, ${r.flags} flags. Hidden: ${r.hidden.name} names, ${r.hidden.path} paths, ${r.hidden.id} ids, ${r.hidden.num} numbers.`,
  );
  if (!r.logOn) out("! The log is off, so this only has what was recorded before that.");
  if (!r.alwaysMask)
    out(`! Your always-mask list is empty. Add names to ${p.alwaysMask}, then run this again.`);
  if (r.second.length)
    out(`  Words that stayed visible and look like names, so check them: ${r.second.join(", ")}`);
  out("Read the file before you share it: masking can miss things.");
  out(
    "Then attach it to an issue at https://github.com/sureandhar-a/skarp/issues/new, or paste it into a chat. skarp sends nothing itself.",
  );
  return 0;
}

export function log({ home, cwd, state, out = console.log } = {}) {
  const p = paths(home, cwd);
  if (state !== "on" && state !== "off") {
    out("Usage: npx skarp-copilot log on | off");
    return 1;
  }
  mkdirSync(p.skarp, { recursive: true, mode: 0o700 });
  writeFileSync(p.config, `${JSON.stringify({ log: state === "on" })}\n`, { mode: 0o600 });
  out(
    state === "on"
      ? "✓ diagnostic log on"
      : "✓ diagnostic log off; what's already kept stays until it ages out",
  );
  return 0;
}

export function remove({ home, cwd, all = false, out = console.log } = {}) {
  const p = paths(home, cwd);
  if (
    existsSync(p.userSettings) &&
    readFileSync(p.userSettings, "utf8").includes("copilot.chat.otel")
  ) {
    const undone = editSettings(p.userSettings, (cur) =>
      Object.fromEntries(Object.entries(cur).filter(([k]) => !(k in telemetrySettings(p)))),
    );
    out(
      undone
        ? "✓ VS Code telemetry settings removed"
        : `! ${p.userSettings} has comments: remove the github.copilot.chat.otel lines yourself.`,
    );
  }
  for (const f of [p.userHooks, p.projectHooks, p.flagPrompt, dirname(p.hook)])
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
  const value = (name) => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  const opts = {
    project: flags.includes("--project"),
    all: flags.includes("--all"),
    telemetry: flags.includes("--telemetry")
      ? true
      : flags.includes("--no-telemetry")
        ? false
        : undefined,
    session: value("--session"),
    since: value("--since"),
    note: value("--note"),
    lookup: value("--lookup"),
    state: flags[0],
  };
  const run = { setup, status, report, log, remove }[cmd ?? ""];
  if (!run) {
    console.log(
      `skarp ${VERSION}\nUsage: npx skarp-copilot setup [--project] [--telemetry | --no-telemetry] | status | report [--all] [--session id] [--since date] [--note text] [--lookup name-1] | log on|off | remove [--all]`,
    );
    process.exit(cmd ? 1 : 0);
  }
  process.exit(await run(opts));
}
