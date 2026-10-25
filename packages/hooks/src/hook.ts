// skarp as a Claude Code plugin: one short process per hook event. It reads the event on stdin,
// keeps per-session state in ~/.skarp, and prints Claude Code's answer. It never blocks the agent
// on its own failure (framework rule 17): any error means exit 0 with no output.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { toLedgerLine } from "@skarp/core";
import {
  ALIGNED,
  checkReply,
  classifyMessage,
  conceptOf,
  decideNextStep,
  matchConcept,
  type Outcome,
  overlap,
  rungFor,
  tokens,
} from "@skarp/kernel";

export type Level = "beginner" | "intermediate" | "advanced";

interface Session {
  // skarp's question, not yet answered; options are the numbered choices the AI wrote as text
  asking?: { block: string; question: string; level: boolean; options?: string[] };
  task?: string; // the task now running
  answer?: string; // your Commit answer for it; undefined when skipped
  block?: string;
  touched: { path: string; content: string }[];
  ran: boolean;
  testsPassed?: boolean;
  reportDue: boolean; // a task ran this turn, so the report is owed at Stop
  sentBack: boolean; // Stop already sent the AI back once this turn
  explainOwed: boolean; // the last task ended without a passing report
}

export const CAP = 3; // limit: one slice size for everyone; per-task caps when asked
const DEPTH: Record<Level, string> = {
  beginner:
    "The user is a beginner: explain every term you use, assume little background, and walk through the key code line by line.",
  intermediate: "The user is intermediate: explain the key ideas and skip the basics.",
  advanced: "The user is advanced: be brief and focus on design choices, trade-offs and risks.",
};
export const SECTIONS = [
  "Changes",
  "How it works",
  "New ideas",
  "Diagram",
  "Tests and checks",
  "Check by hand",
];
// what the AI may use while skarp's question waits: the card, and the search that loads it
// Claude Code's AskUserQuestion, VS Code's askQuestions (vscode/askQuestions, ask_questions)
const ASK_TOOL = /^AskUserQuestion$|ask_?questions/i;
const ASKING_TOOLS = (tool: string) => ASK_TOOL.test(tool) || tool === "ToolSearch";
const RUNS = /^(Bash|run_in_terminal|runInTerminal)$|terminal/i; // shell tools, Claude and VS Code
const WRITES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// a test runner at the start of a command or after && / || / ; (not "cat cart.test.js")
const TEST_RUN =
  /(?:^|&&|\|\||;)\s*(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|npx\s+(?:vitest|jest|mocha)\b|(?:vitest|jest|mocha|pytest|rspec|phpunit)\b|python3?\s+-m\s+(?:pytest|unittest)\b|node\s+--test\b|(?:go|cargo|deno|dotnet|make)\s+test\b)/;
const PIPED = /(^|[^|])\|([^|]|$)/; // `npm test | tail` exits 0 even when tests fail
// praise the kernel's list misses
const MORE_PRAISE =
  /\b(nice (idea|work|job|plan)|awesome|amazing|you nailed it|great (job|work|idea|plan|choice))\b/i;
// a test result stated as numbers: "2/2 passing", "all 5 tests pass"
const TESTS_CLAIM =
  /\b\d+\s*\/\s*\d+\s+(?:tests?\s+)?(?:pass|passing|passed)\b|\ball\s+(?:\d+\s+)?tests?\s+(?:are\s+)?(?:pass|passing|green)\b/i;
// referee checks that make sense on a report; the rest need the in-app chat loop
const REPORT_FAILS: Record<string, string> = {
  praise: "Remove the praise; state facts only.",
  unbacked_action:
    "You say you added or did something that the changed files don't show. Say only what the changes contain.",
  untested_claim:
    "You say tests pass, but skarp saw no passing test run this turn (piping test output, e.g. `| tail`, hides failures). Run the tests plainly, or say they were not run.",
};
// "level advanced", "level: advanced", "set my level to advanced"
const LEVEL_SET =
  /\b(?:set\s+my\s+level\s+to|level\s*(?:[:=]|to|is)?)\s*(beginner|intermediate|advanced)\b/i;
export const levelIn = (text: string) =>
  text.match(LEVEL_SET)?.[1]?.toLowerCase() as Level | undefined;
// an answer to the Level question: a short piece naming one level ("beginner", "I'm a beginner"),
// so "the advanced discount path in cart.js" is not one
export function levelAnswer(text: string): Level | undefined {
  for (const part of text.split(/[,.;\n]/)) {
    const m = part.match(/\b(beginner|intermediate|advanced)\b/i);
    if (m && part.trim().split(/\s+/).length <= 4) return m[1]?.toLowerCase() as Level;
  }
  return undefined;
}
// small talk or a question back while skarp's question waits: not an answer
const SMALL_TALK = /^(thanks|thank you|thx|ty|ok|okay|k|cool|nice|hi|hello|hey)\b/i;
// "actually, just add a comment...": a new task replaces the one waiting for an answer
const REPLACES = /^(actually|instead|never\s?mind|forget (it|that)|scratch that|new task|wait)\b/i;

export function reportRules(level: Level): string {
  const heads = SECTIONS.map((s) => `### ${s}`).join(", ");
  return [
    "skarp report: when you finish this task, end your reply with a section headed exactly `## skarp: what changed`, with these sub-headings in this order:",
    `${heads}.`,
    "Changes: each file you changed, one line on what and why. How it works: a walkthrough of the key code.",
    "New ideas: any concept or term the user may not know, explained. Diagram: plain-text box-and-arrow diagrams of how the changed files connect and how data flows through the change; mark unknown links with `?`.",
    'Tests and checks: tests added, and checks you ran with their results, or "not run". Check by hand: what the user should try themselves.',
    "Never praise. Never claim tests pass unless you ran them and they passed.",
    DEPTH[level],
  ].join("\n");
}

// Which required sub-headings a reply is missing, or ["report"] when it has no skarp section.
export function missingSections(text: string): string[] {
  const at = text.indexOf("## skarp: what changed");
  if (at < 0) return ["report"];
  const report = text.slice(at);
  return SECTIONS.filter((s) => !report.includes(`### ${s}`));
}

// What to fix in a report's shape: missing, empty or out-of-order sections, or a report hidden in
// a code block. It checks shape, not truth (README known gaps).
export function reportFixes(text: string): string[] {
  const missing = missingSections(text);
  if (missing[0] === "report")
    return [
      `Add the \`## skarp: what changed\` report with these sub-headings in order: ${SECTIONS.map((s) => `\`### ${s}\``).join(", ")}.`,
    ];
  const at = text.indexOf("## skarp: what changed");
  const fixes = missing.map((m) => `Add the missing \`### ${m}\` section.`);
  if ((text.slice(0, at).match(/```/g) ?? []).length % 2)
    fixes.push("Write the report as plain text, not inside a code block.");
  const report = text.slice(at);
  const found = SECTIONS.map((s) => ({ s, i: report.indexOf(`### ${s}`) })).filter((x) => x.i >= 0);
  if (found.some((x, k) => k > 0 && x.i < (found[k - 1]?.i ?? 0)))
    fixes.push(`Put the sections in this order: ${SECTIONS.join(", ")}.`);
  for (const { s, i } of found) {
    const body = report.slice(i + `### ${s}`.length).split(/\n#{2,3} /)[0] ?? "";
    if (!/\w/.test(body)) fixes.push(`Write something under \`### ${s}\`.`);
  }
  return fixes;
}

// The fields skarp reads from Claude Code's hook input (recorded from real payloads, 25 Oct).
export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    filePath?: string;
    path?: string;
    notebook_path?: string;
    input?: string; // a Copilot patch text
    newString?: string;
    content?: string;
    new_string?: string;
    edits?: { new_string?: string }[];
    replacements?: {
      filePath?: string;
      file_path?: string;
      newString?: string;
      new_string?: string;
    }[]; // Copilot multi-replace
    code?: string; // Copilot insertEdit
    newCode?: string; // Copilot editNotebook
    command?: string;
  };
  tool_response?: unknown; // a question card's answers; shape differs per agent (readAnswers)
  last_assistant_message?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
}

export function handle(input: HookInput, home: string): object | undefined {
  const sid: string = input.session_id ?? "unknown";
  const file = join(home, "sessions", `${sid.replace(/[^\w-]/g, "")}.json`);
  const s: Session = read(file) ?? {
    touched: [],
    ran: false,
    reportDue: false,
    sentBack: false,
    explainOwed: false,
  };
  const profile: { level?: Level } = read(join(home, "profile.json")) ?? {};
  const log = (type: string, payload: object) => {
    // sync, so lines land in order; best effort, a failed write never stops the agent
    try {
      mkdirSync(join(home, "ledger"), { recursive: true, mode: 0o700 });
      appendFileSync(
        join(home, "ledger", "hooks.jsonl"),
        `${toLedgerLine({ now: () => new Date() }, type as never, sid, payload)}\n`,
        { mode: 0o600 },
      );
    } catch {}
  };
  const save = () => write(file, s);
  const event = input.hook_event_name ?? "";
  const setLevel = (level: Level) => write(join(home, "profile.json"), { ...profile, level });

  if (event === "UserPromptSubmit") {
    const prompt: string = input.prompt ?? "";
    const said = prompt.trim();
    const level = levelIn(prompt);
    if (level) setLevel(level);
    const owed = s.explainOwed
      ? "skarp: your last change has no complete skarp report yet. Give it first, then go on.\n"
      : "";
    // no question card on this surface: the AI wrote skarp's question as text, and this is the answer
    const asked = s.asking;
    if (asked && !REPLACES.test(said)) {
      // "thanks" or a question back is not an answer: skarp's question keeps waiting
      if ((SMALL_TALK.test(said) && said.split(/\s+/).length <= 3) || said.endsWith("?"))
        return context(
          `skarp's question is still waiting: "${asked.question}". Reply to the user's message briefly, then ask skarp's question again (question card, or as text) and stop.`,
        );
      const skipped = /^(skip|not yet)\b/i.test(said);
      // "2" or "option 2" picks the second option the AI wrote
      const answer = said.replace(
        /^(?:option\s*)?(\d+)\b[.)]?/i,
        (m, n) => asked.options?.[Number(n) - 1] ?? m,
      );
      if (skipped) log("answer_skipped", { block: asked.block, via: "typed" });
      else log("answer", { block: asked.block, text: answer, via: "typed" });
      // only a level the user named is saved; none named, the next task asks again
      const lvl = level ?? (asked.level ? levelAnswer(prompt) : undefined);
      if (lvl && !level) setLevel(lvl);
      Object.assign(s, {
        asking: undefined,
        answer: skipped ? undefined : answer,
        sentBack: false,
      });
      save();
      return context(
        `${skipped ? "The user skipped skarp's question." : `The user's answer to skarp's question "${asked.question}": ${answer}`}\nNow do the user's task: ${s.task}\nChange at most ${CAP} files in this slice; skarp refuses more.\n${reportRules(lvl ?? profile.level ?? "intermediate")}`,
      );
    }
    Object.assign(s, { ran: false, testsPassed: undefined }); // a run counts for this turn only
    if (asked) Object.assign(s, { asking: undefined, reportDue: false }); // "actually...": the waiting task is dropped
    save();
    log("user_message", { text: prompt });
    const outcomes = readOutcomes(home);
    const concept = matchConcept(prompt, [...new Set(outcomes.map((o) => o.concept))]);
    const step = decideNextStep({
      pause: "start",
      text: prompt,
      satisfiedIntents: ["orient"], // picking a piece to study needs the in-app chat; not in hooks
      rung: concept ? rungFor(concept, outcomes) : 0,
    });
    if (step.action === "continue" && step.silence) log("silence", step.silence);
    if (step.action !== "ask" && classifyMessage(prompt) !== "task") {
      return owed ? context(owed) : undefined;
    }
    // a task: the report is owed at Stop, whether skarp asks first or stays quiet (faded)
    Object.assign(s, {
      task: prompt,
      answer: undefined,
      block: undefined,
      asking: undefined,
      touched: [],
      ran: false,
      testsPassed: undefined,
      reportDue: true,
      sentBack: false,
    });
    let ask = "";
    if (step.action === "ask") {
      const askLevel = !profile.level && !level;
      s.asking = { block: step.block.id, question: step.block.question_text, level: askLevel };
      s.block = step.block.id;
      log("ask", { block: step.block.id, reason: step.reason });
      ask = askRule(step.block.question_text, step.reason, step.block.brief, askLevel);
    }
    save();
    return context(
      `${owed}${ask}Change at most ${CAP} files in this slice; skarp refuses more.\n${reportRules(level ?? profile.level ?? "intermediate")}`,
    );
  }

  // until skarp's question is answered, every other tool waits
  if (event === "PreToolUse" && s.asking && !ASKING_TOOLS(input.tool_name ?? "")) {
    return deny(
      // the rules ride along: Copilot drops UserPromptSubmit context, so this is all it sees of them
      `skarp: ask the user skarp's question with your question tool first (AskUserQuestion in Claude Code, askQuestions in VS Code): "${s.asking.question}". Nothing else runs until they answer.\nAfter the answer, change at most ${CAP} files.\n${reportRules(profile.level ?? "intermediate")}`,
    );
  }

  const asked = s.asking;
  if (
    (event === "PostToolUse" || event === "PostToolUseFailure") &&
    ASK_TOOL.test(input.tool_name ?? "") &&
    asked
  ) {
    // Claude gives { answers: { question: answer } }; VS Code's shape isn't fixed, so its text is the answer
    // question 1 is skarp's, question 2 (when asked) is the level, free text included
    const answers = readAnswers(input.tool_response);
    const commit = answers[0];
    // a one-question card (Copilot) has no level answer: leave it unset rather than guess
    if (asked.level && event === "PostToolUse" && answers.length > 1)
      setLevel(answers.slice(1).map(levelAnswer).find(Boolean) ?? "intermediate");
    if (event === "PostToolUseFailure" || commit === undefined) {
      // fail open (rule 17): no question card on this surface, so the task goes on, logged as owed
      log("answer_skipped", { block: asked.block, reason: "question tool unavailable" });
    } else if (/^skip\b/i.test(commit.trim())) {
      log("answer_skipped", { block: asked.block });
    } else {
      s.answer = commit;
      log("answer", { block: asked.block, text: commit });
    }
    s.asking = undefined;
    save();
    return undefined;
  }

  const files = event === "PreToolUse" ? writtenFiles(input) : [];
  if (files.length) {
    // a write the classifier didn't call a task: it still gets the cap, grade and report
    if (!s.reportDue)
      Object.assign(s, {
        task: undefined,
        answer: undefined,
        block: undefined,
        touched: [],
        reportDue: true,
        sentBack: false,
      });
    const fresh = files.filter((f) => !s.touched.some((t) => t.path === f.path));
    // one call can write several files (a Copilot patch): it is refused whole when it passes the cap
    if (s.touched.length + fresh.length > CAP) {
      log("tool_call", {
        tool: input.tool_name,
        paths: files.map((f) => f.path),
        denied: "slice cap",
      });
      return deny(
        `skarp: this slice is capped at ${CAP} files (so far: ${s.touched.map((t) => t.path).join(", ") || "none"}). Change fewer files, finish and report on this slice; the user starts the next one as a new task.`,
      );
    }
    for (const f of files) {
      const known = s.touched.find((t) => t.path === f.path);
      if (known) known.content += `\n${f.content}`;
      else s.touched.push(f);
    }
    save();
    return undefined;
  }

  if (
    (event === "PostToolUse" || event === "PostToolUseFailure") &&
    RUNS.test(input.tool_name ?? "")
  ) {
    s.ran = true;
    const cmd = input.tool_input?.command ?? "";
    if (TEST_RUN.test(cmd)) {
      // Copilot has no PostToolUseFailure: read the exit code from its output, else unknown
      const out =
        typeof input.tool_response === "string"
          ? input.tool_response
          : JSON.stringify(input.tool_response ?? "");
      // Copilot's Bash says "success" even on exit 1; the code is only in its text
      const code = out.match(/exit code[:\s]+(\d+)/i)?.[1];
      let passed: boolean | undefined =
        event === "PostToolUseFailure"
          ? false
          : code !== undefined
            ? code === "0"
            : input.tool_name === "Bash"
              ? true
              : undefined;
      if (PIPED.test(cmd) && !/pipefail/.test(cmd) && passed) passed = undefined; // the pipe's exit, not the tests'
      s.testsPassed = passed;
      log("run", { command: cmd, passed: passed ?? "unknown" });
    }
    save();
    return undefined;
  }

  if (event === "Stop" && s.reportDue) {
    if (s.asking) {
      if (!s.sentBack && !input.stop_hook_active) {
        s.sentBack = true;
        save();
        return {
          decision: "block",
          reason: `skarp: ask the user skarp's question with your question tool first (AskUserQuestion in Claude Code, askQuestions in VS Code; load it with ToolSearch if needed): "${s.asking.question}". If that tool is not available, write the question and its options as text and stop; the user's next message is the answer.`,
        };
      }
      // the AI wrote the question as text (no card here); the user's next message answers it,
      // maybe by number, so keep the numbered options it wrote
      const options = [
        ...(input.last_assistant_message ?? "").matchAll(
          /^\s*(?:[-*]\s*)?\**(\d+)[.)]\**\s*(.+)$/gm,
        ),
      ].map((m) => (m[2] ?? "").replace(/\*\*/g, "").trim());
      if (options.length) {
        s.asking.options = options;
        save();
      }
      return undefined;
    }
    // Copilot's Stop may carry no reply text: read it from the transcript, or say the report
    // can't be checked (rule 24: never fake a check)
    const reply = input.last_assistant_message ?? lastAssistantText(input.transcript_path);
    if (reply === undefined) {
      log("referee", { check: "report", not_run: "no reply text on this surface" });
      Object.assign(s, { reportDue: false, sentBack: false });
      save();
      return {
        systemMessage: [
          ...grade(s, sid, log),
          "skarp: report not checked here (this agent does not share its reply).",
        ].join("\n"),
      };
    }
    const shape = reportFixes(reply);
    const failed = new Set(
      checkReply(reply, undefined, [], {
        edited: s.touched.map((t) => t.path),
        heldText: s.touched.map((t) => t.content).join("\n"),
        ran: s.ran,
        testsPassed: s.testsPassed,
      }).filter((f) => f in REPORT_FAILS),
    );
    if (MORE_PRAISE.test(reply)) failed.add("praise");
    if (TESTS_CLAIM.test(reply) && !s.testsPassed) failed.add("untested_claim");
    const fixes = [...shape, ...[...failed].map((f) => REPORT_FAILS[f])];
    log("referee", { check: "report", shape, failed: [...failed] });
    if (fixes.length && !s.sentBack && !input.stop_hook_active) {
      s.sentBack = true;
      save();
      return { decision: "block", reason: `skarp report check:\n- ${fixes.join("\n- ")}` };
    }

    const lines = grade(s, sid, log);
    lines.push(
      fixes.length
        ? "skarp: the report is incomplete; it is owed on your next message."
        : "skarp: report checked.",
    );
    Object.assign(s, { reportDue: false, sentBack: false, explainOwed: fixes.length > 0 });
    save();
    return { systemMessage: lines.join("\n") };
  }

  // the owed report came in a later turn with no new task
  if (event === "Stop" && s.explainOwed) {
    const reply = input.last_assistant_message ?? lastAssistantText(input.transcript_path);
    if (reply !== undefined && !reportFixes(reply).length) {
      s.explainOwed = false;
      save();
      return { systemMessage: "skarp: owed report checked." };
    }
  }
  return undefined;
}

// The plan grade (Gap): your Commit answer against the files really touched. Never "correct".
function grade(s: Session, sid: string, log: (type: string, payload: object) => void): string[] {
  const lines: string[] = [];
  if (s.touched.length && s.answer !== undefined) {
    const score = overlap(s.answer, s.touched);
    const said = new Set(tokens(s.answer));
    const missed = s.touched.map((t) => t.path).filter((p) => !tokens(p).some((w) => said.has(w)));
    const pass = score >= ALIGNED;
    const day = new Date().toISOString().slice(0, 10);
    const o: Outcome = {
      concept: conceptOf(s.touched[0]?.path ?? ""),
      chat: sid,
      day,
      block: s.block ?? "",
      pass,
    };
    log("outcome", { ...o, score });
    lines.push(
      pass
        ? `skarp: your plan matched the change (${s.touched.length} file${s.touched.length > 1 ? "s" : ""}).`
        : `skarp: the change went where your plan didn't${missed.length ? `: ${missed.join(", ")}` : ""}.`,
    );
  } else if (s.touched.length) lines.push("skarp: no plan was given, so the change is not graded.");
  return lines;
}

// The files one write call touches. Claude passes one path; Copilot may pass one patch text that
// adds or changes several files, under a name like apply_patch or as the whole input.
export function writtenFiles(input: HookInput): { path: string; content: string }[] {
  const tool = input.tool_name ?? "";
  const ti = input.tool_input ?? {};
  const rel = (p: string) => (isAbsolute(p) ? relative(input.cwd ?? "", p) : p) || "?";
  if (RUNS.test(tool)) return shellWrites(String(ti.command ?? ""), rel);
  if (!WRITES.has(tool) && !/create|edit|replace|insert|patch|write/i.test(tool)) return [];
  if (typeof ti.input === "string" && /^\*\*\* (Add|Update|Delete) File: /m.test(ti.input)) {
    const patch = ti.input;
    const paths = [...patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)];
    return [...new Set(paths.map((m) => rel((m[1] ?? "").trim())))].map((path) => ({
      path,
      content: patch,
    }));
  }
  // Copilot's multi-replace: { replacements: [{ filePath, newString }] }, maybe several files
  if (Array.isArray(ti.replacements)) {
    const out: { path: string; content: string }[] = [];
    for (const r of ti.replacements) {
      const p = r.filePath ?? r.file_path;
      if (!p) continue;
      const known = out.find((o) => o.path === rel(p));
      const text = r.newString ?? r.new_string ?? "";
      if (known) known.content += `\n${text}`;
      else out.push({ path: rel(p), content: text });
    }
    if (out.length) return out;
  }
  const path = ti.file_path ?? ti.filePath ?? ti.notebook_path ?? ti.path;
  if (!path) return []; // e.g. TodoWrite: a "write" with no file
  const content = [
    ti.content,
    ti.new_string,
    ti.newString,
    ti.code,
    ti.newCode,
    ...(ti.edits ?? []).map((e) => e.new_string),
  ]
    .filter(Boolean)
    .join("\n");
  return [{ path: rel(path), content }];
}

// Files a shell command writes in the project: `> f`, `>> f` and `tee [-a] f`. Heredoc bodies and
// quoted text are dropped first, so `<div>` or 'a > b' are not read as writes; fd redirects
// (2>, >&2), /dev/* and paths outside the project don't count.
// ponytail: redirects and tee only; sed -i, cp, mv and scripts writing files are not seen (the
// desktop app's file watcher covers those)
function shellWrites(cmd: string, rel: (p: string) => string): { path: string; content: string }[] {
  const bare = cmd
    .replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\s*\1[ \t]*(?=\n|$)/g, "$2")
    .replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
  const targets = [
    ...bare.matchAll(/(?<![\d&<>])>>?\s*([^\s;&|<>()]+)/g),
    ...bare.matchAll(/\btee\s+(?:-a\s+)?([^\s;&|<>()]+)/g),
  ].map((m) => m[1] ?? "");
  const paths = targets
    .filter((p) => p && !p.startsWith("/dev/"))
    .map((p) => rel(p).replace(/^\.\//, ""))
    .filter((p) => !p.startsWith(".."));
  return [...new Set(paths)].map((path) => ({ path, content: cmd }));
}

// VS Code's Copilot harness sends camelCase and may leave the event name out: the hooks
// file then passes it on the command line.
export function normalize(raw: Record<string, unknown>, event?: string): HookInput {
  let args = raw.tool_input ?? raw.toolArgs;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = { input: args }; // a bare patch text
    }
  }
  return {
    ...raw,
    session_id: (raw.session_id ?? raw.sessionId) as string | undefined,
    hook_event_name: (raw.hook_event_name ?? raw.hookEventName ?? event) as string | undefined,
    tool_name: (raw.tool_name ?? raw.toolName) as string | undefined,
    tool_input: args as HookInput["tool_input"],
    tool_response: raw.tool_response ?? raw.tool_result, // Copilot CLI harness: tool_result
  };
}

// The answers a question card returned, in question order. Claude: { answers: { q: "label" } }.
// VS Code (seen 25 Oct): a JSON string of { answers: { header: { selected: [...], freeText, skipped } } }.
export function readAnswers(r: unknown): string[] {
  let v = r;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [v as string]; // plain text is the answer
    }
  }
  // Copilot CLI harness: { text_result_for_llm: "User responded: X" | "User cancelled the request." }
  const said = (v as { text_result_for_llm?: unknown } | undefined)?.text_result_for_llm;
  if (typeof said === "string")
    return /cancelled/i.test(said) ? ["Skip"] : [said.replace(/^User responded:\s*/i, "")];
  const all = (v as { answers?: Record<string, unknown> } | undefined)?.answers;
  if (!all) return v ? [JSON.stringify(v)] : [];
  return Object.values(all).map((a) => {
    if (typeof a !== "object" || a === null) return String(a);
    const x = a as { selected?: string[]; freeText?: string | null; skipped?: boolean };
    if (x.skipped) return "Skip";
    return [...(x.selected ?? []), x.freeText].filter(Boolean).join(", ");
  });
}

function deny(reason: string) {
  return {
    // both shapes: hookSpecificOutput for Claude Code, top-level for VS Code's Copilot harness
    permissionDecision: "deny",
    permissionDecisionReason: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

// skarp's question goes through Claude Code's own question card, so it is an input, not a warning.
export function askRule(question: string, reason: string, brief: string, level: boolean): string {
  return `${[
    "skarp rule, before anything else: ask the user with your question tool (AskUserQuestion in Claude Code, askQuestions in VS Code), so they get a question card.",
    `Question 1, header "skarp": "${question}" (${reason}) Options: ${brief} Use 2 or 3 options from the task's words alone, then a last option labelled "Skip" described as "Go ahead without answering; skarp logs it as owed".`,
    level
      ? 'Question 2, header "Level": "Your level, so skarp\'s explanations fit you?" with options "beginner", "intermediate", "advanced".'
      : "",
    "If that tool is not loaded, load it with ToolSearch first, without telling the user about it. If no question tool is available at all, write the question and options as text and stop; the user's next message is the answer.",
    "Do not read files, run commands or start the task until the user answers; skarp refuses other tools until then. After the answer, do the user's task.",
  ]
    .filter(Boolean)
    .join("\n")}\n`;
}

function context(text: string) {
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } };
}

function read<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

// limit: last write wins; parallel tool calls in one session can race. Per-session lock if it bites.
function write(file: string, data: object) {
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
}

// The last assistant text in a JSON-lines transcript, if there is one we can read.
function lastAssistantText(path?: string): string | undefined {
  if (!path) return undefined;
  try {
    for (const line of readFileSync(path, "utf8").trim().split("\n").reverse()) {
      const e = JSON.parse(line);
      // Copilot CLI: { type: "assistant.message", data: { content } }
      const m =
        e.type === "assistant.message" ? { role: "assistant", ...e.data } : (e.message ?? e);
      if (m.role !== "assistant") continue;
      const c = m.content;
      const text =
        typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x.text ?? "").join("") : "";
      if (text) return text;
    }
  } catch {}
  return undefined;
}

function readOutcomes(home: string): Outcome[] {
  try {
    return readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === "outcome")
      .map((e) => e.payload as Outcome);
  } catch {
    return [];
  }
}

if (import.meta.main) {
  try {
    const out = handle(
      normalize(JSON.parse(readFileSync(0, "utf8")), process.argv[2]),
      process.env.SKARP_HOME ?? join(homedir(), ".skarp"),
    );
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {
    // fail open: the agent carries on without skarp
  }
}
