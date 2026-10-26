// skarp as a Claude Code plugin: one short process per hook event. It reads the event on stdin,
// keeps per-session state in ~/.skarp, and prints Claude Code's answer. It never blocks the agent
// on its own failure (framework rule 17): any error means exit 0 with no output.

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  wantsBrainstorm,
  wantsExplain,
} from "@skarp/kernel";
import {
  BS_DECIDE,
  BS_QUESTION,
  BUILD_IT,
  brainstormFixes,
  brainstormRules,
  brainstormSummary,
  cardFixes,
  DECIDE,
  DONE_LISTING,
  EXPLAIN_BACK,
  EXPLAIN_QUESTION,
  EXPLAIN_REPORT,
  explainRules,
  highStakes,
  hintsFor,
  type MapEvent,
  type Mode,
  optionsOk,
  type Phase,
  parseMap,
  RESUME,
  type ReportShape,
  TASK_REPORT,
  UNLOCK,
} from "./modes.ts";

export type Level = "beginner" | "intermediate" | "advanced";

interface Session {
  // skarp's question, not yet answered; options are the numbered choices the AI wrote as text
  asking?: { block: string; question: string; level: boolean; options?: string[]; fixed?: number };
  task?: string; // the task now running
  answer?: string; // your Commit answer for it; undefined when skipped
  block?: string;
  touched: { path: string; content: string }[];
  ran: boolean;
  testsPassed?: boolean;
  reportDue: boolean; // a task ran this turn, so the report is owed at Stop
  sentBack: boolean; // Stop already sent the AI back once this turn
  explainOwed: boolean; // the last task ended without a passing report
  id?: string; // the running task's id, on its ledger lines
  seen?: string[]; // events whose field names are logged already
  mode?: Mode; // what the open work is: a task, an explanation or a brainstorm
  explainBack?: boolean; // an explanation ended with skarp's "this works because ___"
  bs?: Brainstorm; // the open brainstorm
  lastDecision?: string; // the last brainstorm's decision: "build it" starts it as a task
  check?: string; // for a bug: what the user says would show it's fixed
  closing?: boolean; // the user said it's done: the report is due this turn
}

interface Brainstorm {
  id: string;
  topic: string;
  phase: Phase;
  stakes: boolean;
  unlocked: boolean; // the user asked for the AI's ideas first
  said: string[]; // the user's own words, for quotes
  ideas: number;
  whyAsked?: boolean;
}

export const CAP = 3; // limit: one slice size for everyone; per-task caps when asked
const DEPTH: Record<Level, string> = {
  beginner:
    "The user is a beginner: explain every term you use, assume little background, and walk through the key code line by line.",
  intermediate: "The user is intermediate: explain the key ideas and skip the basics.",
  advanced: "The user is advanced: be brief and focus on design choices, trade-offs and risks.",
};
export const SECTIONS = TASK_REPORT.sections;
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
    `skarp report: when you finish this task, end your reply with a section headed exactly \`${TASK_REPORT.head}\`, with these sub-headings in this order:`,
    `${heads}.`,
    "Changes: each file you changed, one line on what and why. How it works: a walkthrough of the key code.",
    "New ideas: any concept or term the user may not know, explained. Diagram: plain-text box-and-arrow diagrams of how the changed files connect and how data flows through the change; mark unknown links with `?`.",
    'Tests and checks: tests added, and checks you ran with their results, or "not run". Check by hand: what the user should try themselves.',
    "Never praise. Never claim tests pass unless you ran them and they passed.",
    DEPTH[level],
  ].join("\n");
}

// Which required sub-headings a reply is missing, or ["report"] when it has no skarp section.
export function missingSections(text: string, shape: ReportShape = TASK_REPORT): string[] {
  const at = text.indexOf(shape.head);
  if (at < 0) return ["report"];
  const report = text.slice(at);
  return shape.sections.filter((s) => !report.includes(`### ${s}`));
}

// What to fix in a report's shape: missing, empty or out-of-order sections, or a report hidden in
// a code block. It checks shape, not truth (README known gaps).
export function reportFixes(text: string, shape: ReportShape = TASK_REPORT): string[] {
  const SECTIONS = shape.sections;
  const missing = missingSections(text, shape);
  if (missing[0] === "report")
    return [
      `Add the \`${shape.head}\` report with these sub-headings in order: ${SECTIONS.map((s) => `\`### ${s}\``).join(", ")}.`,
    ];
  const at = text.indexOf(shape.head);
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
  raw?: Record<string, unknown>; // the agent's own input, for its field names
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
      const where = { cwd: input.cwd, task_id: s.id };
      appendFileSync(
        join(home, "ledger", "hooks.jsonl"),
        `${toLedgerLine({ now: () => new Date() }, type as never, sid, { ...payload, ...where })}\n`,
        { mode: 0o600 },
      );
    } catch {}
  };
  const save = () => write(file, s);
  const event = input.hook_event_name ?? "";
  // field names only, never values, once per event: shows what an agent really sends
  if (!s.seen?.includes(event)) {
    s.seen = [...(s.seen ?? []), event];
    log("seen", { event, fields: Object.keys(input.raw ?? input).sort() });
    save();
  }

  // Copilot drops what a prompt hook returns, so the standing rules go in once per session
  if (event === "SessionStart") return startContext(standingRules(profile.level ?? "intermediate"));
  const setLevel = (level: Level) => write(join(home, "profile.json"), { ...profile, level });

  if (event === "UserPromptSubmit") {
    const prompt: string = input.prompt ?? "";
    const said = prompt.trim();
    const level = levelIn(prompt);
    if (level) setLevel(level);
    const owed = s.explainOwed
      ? "skarp: your last change has no complete skarp report yet. Give it first, then go on.\n"
      : "";
    // the answer to an explanation's closing "this works because ___", unless it's new work
    if (s.explainBack && !s.asking) {
      s.explainBack = false;
      save();
      const isNew =
        classifyMessage(prompt) === "task" || wantsExplain(prompt) || wantsBrainstorm(prompt);
      if (!isNew && !/^(skip|not yet)\b/i.test(said)) {
        log("explain_back", { text: prompt });
        return context(
          `The user answered skarp's "${EXPLAIN_BACK}": ${prompt}\nIn one or two lines, say what in their answer matches the code and what is missing, citing files. No praise.`,
        );
      }
      log("explain_back_skipped", {});
    }
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
      if (s.mode === "brainstorm" && s.bs) {
        const note = brainstormTurn(s, s.bs, skipped ? "your ideas first" : answer, home, log);
        save();
        return context(note);
      }
      save();
      return context(
        `${skipped ? "The user skipped skarp's question." : `The user's answer to skarp's question "${asked.question}": ${answer}`}\n${s.mode === "explain" ? "Now explain" : "Now do the user's task"}: ${s.task}\n${rulesFor(s, lvl ?? profile.level ?? "intermediate")}`,
      );
    }
    Object.assign(s, { ran: false, testsPassed: undefined }); // a run counts for this turn only
    if (asked) Object.assign(s, { asking: undefined, reportDue: false }); // "actually...": the waiting task is dropped
    save();
    log("user_message", { text: prompt });
    const askLevel = !profile.level && !level;
    // an open brainstorm: every message is part of it until a decision, or "actually / new task"
    if (s.mode === "brainstorm" && s.bs) {
      if (!REPLACES.test(said) && !/^end (the )?brainstorm\b/i.test(said)) {
        const note = brainstormTurn(s, s.bs, prompt, home, log);
        save();
        return context(note);
      }
      closeBrainstorm(s, s.bs, home, log);
      save();
    }
    // an open task carries on across turns ("still failing", "try the other file") until it's done
    const open = s.mode === "task" && s.reportDue && s.task !== undefined;
    if (open && !REPLACES.test(said) && !newTask(s, prompt)) {
      const lvl = level ?? profile.level ?? "intermediate";
      if (DONE_TASK.test(said)) {
        s.closing = true;
        log("task_closing", {});
        save();
        return context(
          `${owed}The user says the task is done: ${s.task}\nGive the full skarp report now, covering every change in this task.\n${rulesFor(s, lvl)}`,
        );
      }
      log("task_continues", {});
      save();
      return context(`${owed}This continues the open task: ${s.task}\n${rulesFor(s, lvl)}`);
    }
    // "build it" after a brainstorm: its decision is the plan, so skarp doesn't ask twice
    if (s.lastDecision && BUILD_IT.test(said)) {
      const decision = s.lastDecision;
      Object.assign(s, fresh(`Build the brainstorm's decision: ${decision}`, "task"), {
        answer: decision,
        block: "brainstorm",
        lastDecision: undefined,
      });
      log("answer", { block: "brainstorm", text: decision, via: "decision" });
      save();
      return context(
        `${owed}The user wants the brainstorm's decision built: ${decision}\n${rulesFor(s, level ?? profile.level ?? "intermediate")}`,
      );
    }
    // brainstorm: your idea first, then a senior's questions; the process, ideas and outcome are kept
    if (wantsBrainstorm(prompt) || RESUME.test(said)) {
      const resumed = RESUME.test(said) ? lastBrainstorm(home, prompt) : undefined;
      Object.assign(s, fresh(prompt, "brainstorm"), { reportDue: false });
      const bs: Brainstorm = {
        id: randomUUID().slice(0, 8),
        topic: prompt.slice(0, 120),
        phase: resumed ? "stress" : "you-first",
        stakes: highStakes(prompt),
        unlocked: false,
        said: [],
        ideas: resumed?.ideas ?? 0,
      };
      s.bs = bs;
      bsLog(home, bs, { kind: "start", text: prompt, resumed: resumed?.path });
      log("brainstorm_start", { id: bs.id, resumed: resumed?.path });
      // the idea may come with the request: "I have a rough idea: move the queue to Redis"
      if (resumed || IDEA_IN.test(prompt)) {
        const note = resumed
          ? `skarp: this continues an earlier brainstorm. Its record:\n${resumed.md}`
          : brainstormTurn(s, bs, prompt, home, log);
        save();
        return context(
          `${owed}${resumed ? `${note}\n${brainstormRules("stress", bs.stakes)}` : note}`,
        );
      }
      s.asking = { block: "BS1", question: BS_QUESTION, level: false };
      s.block = "BS1";
      log("ask", { block: "BS1", reason: "brainstorm: your idea first" });
      save();
      return context(
        `${owed}${askRule(BS_QUESTION, "skarp asks for your own idea before the AI's.", hintRule(hintsFor("BS1")), false)}${brainstormRules("you-first", bs.stakes)}`,
      );
    }
    // explain: your guess first, then a checked explanation; no files change
    if (wantsExplain(prompt) && !BUILD_IT.test(said)) {
      Object.assign(s, fresh(prompt, "explain"), {
        block: "EX1",
        asking: { block: "EX1", question: EXPLAIN_QUESTION, level: askLevel },
      });
      log("ask", { block: "EX1", reason: "explain: your guess first" });
      save();
      return context(
        `${owed}${askRule(EXPLAIN_QUESTION, "skarp asks for your own view before the AI's.", hintRule(hintsFor("EX1")), askLevel)}${rulesFor(s, level ?? profile.level ?? "intermediate")}`,
      );
    }
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
    Object.assign(s, fresh(prompt, "task"));
    let ask = "";
    if (step.action === "ask") {
      s.asking = { block: step.block.id, question: step.block.question_text, level: askLevel };
      s.block = step.block.id;
      log("ask", { block: step.block.id, reason: step.reason });
      ask = askRule(
        step.block.question_text,
        step.reason,
        hintRule(hintsFor(step.block.id)),
        askLevel,
        step.block.id === BUG_BLOCK,
      );
    }
    save();
    return context(`${owed}${ask}${rulesFor(s, level ?? profile.level ?? "intermediate")}`);
  }

  // until skarp's question is answered, every other tool waits
  // the card must ask skarp's question with skarp's options: the user's view comes first
  if (event === "PreToolUse" && s.asking && ASK_TOOL.test(input.tool_name ?? "")) {
    const fixes = cardFixes(input.tool_input, s.asking.question, hintsFor(s.asking.block));
    if (fixes.length && (s.asking.fixed ?? 0) < 2) {
      s.asking.fixed = (s.asking.fixed ?? 0) + 1;
      log("card_refused", { block: s.asking.block, fixes });
      save();
      return deny(`skarp: fix the question card.\n- ${fixes.join("\n- ")}`);
    }
    return undefined;
  }
  if (event === "PreToolUse" && s.asking && !ASKING_TOOLS(input.tool_name ?? "")) {
    return deny(
      // the rules ride along: Copilot drops UserPromptSubmit context, so this is all it sees of them
      `skarp: ask the user skarp's question with your question tool first (AskUserQuestion in Claude Code, askQuestions in VS Code): "${s.asking.question}". Nothing else runs until they answer.\nAfter the answer:\n${rulesFor(s, profile.level ?? "intermediate")}`,
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
    // a bug's second question: what would show it's fixed (a level answer is not one)
    const check = asked.block === BUG_BLOCK ? answers[1] : undefined;
    if (check && !levelAnswer(check) && !/^skip\b/i.test(check)) {
      s.check = check;
      log("answer", { block: "check", text: check });
    }
    s.asking = undefined;
    if (s.mode === "brainstorm" && s.bs) {
      const note = brainstormTurn(s, s.bs, s.answer ?? "your ideas first", home, log);
      save();
      return {
        additionalContext: note,
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note },
      };
    }
    save();
    return undefined;
  }

  const files = event === "PreToolUse" ? writtenFiles(input) : [];
  if (files.length && ((s.reportDue && s.mode === "explain") || s.mode === "brainstorm"))
    return deny(
      `skarp: ${s.mode} mode changes no files. Finish the ${s.mode === "explain" ? "explanation" : "brainstorm"}; if the user wants a change, they say 'build it' and it becomes a task.`,
    );
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

  if (event === "Stop" && s.mode === "brainstorm" && s.bs && !s.asking) {
    const bs = s.bs;
    const reply = input.last_assistant_message ?? lastAssistantText(input.transcript_path);
    if (reply === undefined) {
      log("referee", { check: "brainstorm", not_run: "no reply text on this surface" });
      return undefined;
    }
    const fixes = brainstormFixes(reply, bs.phase, bs.said, bs.stakes, bs.unlocked);
    if (MORE_PRAISE.test(reply)) fixes.push(REPORT_FAILS.praise ?? "");
    log("referee", { check: "brainstorm", phase: bs.phase, fixes });
    if (fixes.length && !s.sentBack && !input.stop_hook_active) {
      s.sentBack = true;
      save();
      return {
        decision: "block",
        reason: `skarp brainstorm check:\n- ${fixes.join("\n- ")}\n${brainstormRules(bs.phase, bs.stakes)}`,
      };
    }
    // the turn as it stands goes on the record; ideas the AI raised stay marked as its own
    bsLog(home, bs, { kind: "turn", role: "ai", text: reply });
    for (const e of parseMap(reply)) {
      if (e.type === "idea" && e.by === "ai") bs.ideas++;
      if (!(e.type === "idea" && e.by === "you")) bsLog(home, bs, { kind: "map", ...e });
    }
    save();
    return undefined;
  }

  if (event === "Stop" && (s.reportDue || s.asking)) {
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
      const hints = hintsFor(s.asking.block);
      if (
        options.length &&
        !optionsOk(options, hints) &&
        !s.asking.fixed &&
        !input.stop_hook_active
      ) {
        s.asking.fixed = 1;
        save();
        return {
          decision: "block",
          reason: `skarp: ask skarp's question "${s.asking.question}" with exactly these options, as text: ${[...hints, "Skip"].map((h, i) => `${i + 1}. ${h}`).join(" ")}. Then stop; the user's next message is the answer.`,
        };
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
    const kind = s.mode ?? "task";
    // not done yet: a short status keeps the task open, and the report waits until it's done
    if (kind === "task" && !reply.includes(TASK_REPORT.head) && !s.closing) {
      if (/#{2,3} skarp: status/.test(reply)) {
        log("progress", { files: s.touched.length });
        s.sentBack = false;
        save();
        return undefined;
      }
      if (!s.touched.length) return undefined; // nothing changed yet: nothing is owed
      if (!s.sentBack && !input.stop_hook_active) {
        s.sentBack = true;
        save();
        return {
          decision: "block",
          reason:
            "skarp: you changed files but gave neither the report nor a status. If the task is done, give the full `## skarp: what changed` report; if not, end with `### skarp: status` (found so far, tried, next step).",
        };
      }
    }
    saveReport(home, kind, reply, log);
    const shape = reportFixes(reply, kind === "explain" ? EXPLAIN_REPORT : TASK_REPORT);
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
    if (kind === "explain")
      lines.push(
        fixes.length ? "skarp: the explanation is incomplete." : "skarp: explanation checked.",
      );
    else
      lines.push(
        fixes.length
          ? "skarp: the report is incomplete; it is owed on your next message."
          : "skarp: report checked.",
      );
    Object.assign(s, {
      reportDue: false,
      sentBack: false,
      closing: false,
      explainOwed: kind === "task" && fixes.length > 0,
      explainBack: kind === "explain" && !fixes.length,
    });
    save();
    return { systemMessage: lines.join("\n") };
  }

  // the owed report came in a later turn with no new task
  if (event === "Stop" && s.explainOwed) {
    const reply = input.last_assistant_message ?? lastAssistantText(input.transcript_path);
    if (reply !== undefined && !reportFixes(reply).length) {
      saveReport(home, "task", reply, log);
      s.explainOwed = false;
      save();
      return { systemMessage: "skarp: owed report checked." };
    }
  }
  return undefined;
}

// a request that already carries the user's idea
const IDEA_IN =
  /\b(idea|plan|thought|approach)\b\s*(is|was|:|-|–)\s*\S|\bwhat if we\b|\bi (think|want) (we|to)\b/i;
const REASON = /\b(because|since|so that|as it|as we|due to|which means|otherwise)\b/i;

const bsDir = (home: string, id: string) => join(home, "brainstorms", id);

// The brainstorm's own log, append-only, written by the hook: the process, ideas and outcome.
function bsLog(home: string, bs: Brainstorm, event: object) {
  try {
    mkdirSync(bsDir(home, bs.id), { recursive: true, mode: 0o700 });
    appendFileSync(
      join(bsDir(home, bs.id), "log.jsonl"),
      `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`,
      { mode: 0o600 },
    );
  } catch {}
}

// One message from the user inside a brainstorm: move the phase on, record what they said,
// and return what the AI is told for this turn.
function brainstormTurn(
  s: Session,
  bs: Brainstorm,
  text: string,
  home: string,
  log: (type: string, payload: object) => void,
): string {
  const idea = () => {
    bs.ideas++;
    bsLog(home, bs, { kind: "map", type: "idea", idea: `I${bs.ideas}`, by: "you", text });
    return `The user's idea, I${bs.ideas} (you): "${text}". Record it in the map.`;
  };
  bs.said.push(text);
  s.sentBack = false;
  bsLog(home, bs, { kind: "turn", role: "you", text });
  bs.stakes ||= highStakes(text);
  let note = "";
  if (bs.phase === "you-first") {
    if (UNLOCK.test(text) || /^(skip|not yet)\b/i.test(text.trim())) {
      bs.unlocked = true;
      bs.phase = "stress";
      log("answer_skipped", { block: "BS1", reason: "asked for the AI's ideas first" });
      note =
        "The user asked for your ideas first (skarp logs it). Offer 2-3 clearly different directions, labelled (ai) in the map, then ask which fits their situation.";
    } else {
      bs.phase = "listing";
      note = `${idea()} Now ask: "Anything else? Say done when you have listed them."`;
    }
  } else if (bs.phase === "listing") {
    if (DONE_LISTING.test(text.trim())) {
      bs.phase = "stress";
      note = "The user has listed their ideas. Start the stress test: one question at a time.";
    } else note = `${idea()} Ask: "Anything else? Say done when you have listed them."`;
  } else if (bs.phase === "stress") {
    if (DECIDE.test(text) || BUILD_IT.test(text.trim())) {
      if (bs.ideas < 2) {
        note =
          "The user wants to decide, but a decision needs at least two options. Ask for one more option, or whether doing nothing is the rival.";
      } else if (REASON.test(text) && !BUILD_IT.test(text.trim())) {
        return decide(s, bs, text, text, home, log);
      } else {
        bs.phase = "decide";
        note = `The user wants to decide. Ask exactly: "${BS_DECIDE}"`;
      }
    } else note = "Go on with the stress test: one question at a time.";
  } else {
    // decide: the user's own words are the decision; a reason is required
    if (bs.whyAsked) return decide(s, bs, bs.said.at(-2) ?? text, text, home, log);
    if (!REASON.test(text) && text.split(/\s+/).length < 8) {
      bs.whyAsked = true;
      note = 'The user picked without a reason. Ask: "Why that one, in your own words?"';
    } else return decide(s, bs, text, text, home, log);
  }
  return `${note}\n${brainstormRules(bs.phase, bs.stakes)}`;
}

// The outcome: the user's pick and their why, kept with the rivals; then the brainstorm closes.
function decide(
  s: Session,
  bs: Brainstorm,
  chosen: string,
  why: string,
  home: string,
  log: (type: string, payload: object) => void,
): string {
  bsLog(home, bs, { kind: "decision", chosen, why });
  const path = closeBrainstorm(s, bs, home, log, chosen, why);
  s.lastDecision = chosen;
  return `skarp recorded the user's decision: "${chosen}"${why !== chosen ? `, because "${why}"` : ""}. The brainstorm is closed${path ? ` and saved to ${path}` : ""}. In two lines: restate the decision and the main open question, and tell the user that "build it" starts it as a task. No praise.`;
}

function closeBrainstorm(
  s: Session,
  bs: Brainstorm,
  home: string,
  log: (type: string, payload: object) => void,
  chosen?: string,
  why?: string,
): string | undefined {
  let path: string | undefined;
  try {
    const events = readFileSync(join(bsDir(home, bs.id), "log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as MapEvent & { kind?: string });
    const sum = brainstormSummary(bs.topic, events);
    path = join(bsDir(home, bs.id), "summary.md");
    writeFileSync(path, sum.md, { mode: 0o600 });
    log("brainstorm", {
      id: bs.id,
      topic: bs.topic,
      decision: chosen,
      why,
      path,
      ideas_by_you: sum.byYou,
      ideas_by_ai: sum.byAi,
      coverage: sum.coverage,
    });
  } catch {}
  Object.assign(s, { mode: undefined, bs: undefined, reportDue: false });
  return path;
}

// The latest saved brainstorm that shares a word with the request.
function lastBrainstorm(
  home: string,
  prompt: string,
): { md: string; path: string; ideas: number } | undefined {
  try {
    const dir = join(home, "brainstorms");
    const words = new Set(tokens(prompt));
    const found = readdirSync(dir)
      .map((id) => join(dir, id, "summary.md"))
      .filter((p) => existsSync(p))
      .map((p) => ({ p, md: readFileSync(p, "utf8"), t: statSync(p).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .find((x) => tokens(x.md.split("\n")[0] ?? "").some((w) => words.has(w)));
    if (!found) return undefined;
    return { md: found.md, path: found.p, ideas: (found.md.match(/^- \*\*I\d+/gm) ?? []).length };
  } catch {
    return undefined;
  }
}

// The state a new piece of work starts from.
function fresh(task: string, mode: Mode): Partial<Session> {
  return {
    id: randomUUID().slice(0, 8),
    mode,
    task,
    answer: undefined,
    block: undefined,
    asking: undefined,
    touched: [],
    ran: false,
    testsPassed: undefined,
    reportDue: true,
    sentBack: false,
    explainBack: false,
    check: undefined,
    closing: false,
  };
}

// The rules for the open work, given after skarp's question (and in deny reasons for Copilot).
function rulesFor(s: Session, level: Level): string {
  if (s.mode === "explain") return `${explainRules(s.answer)}\n${DEPTH[level]}`;
  return [
    `Change at most ${CAP} files in this slice; skarp refuses more.`,
    PROGRESS_RULE,
    reportRules(level),
    s.check
      ? `Under ### Tests and checks, also say whether "${s.check}" (the user's own check for the fix) was done, and its result.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const PROGRESS_RULE =
  "If the task isn't finished at the end of this reply (still investigating, or a fix not yet confirmed), end with `### skarp: status` (found so far, tried, next step) instead of the report. Give the full report only when the task is done.";
// "fixed", "works now", "that did it": the user closes the open task
const DONE_TASK =
  /^(it'?s )?(fixed|works( now)?|working( now)?|that (did it|worked|fixed it)|all good|done|ship it|looks good)\b/i;
const BUG_BLOCK = "A14";

// A message during an open task is a new task only when it names different work: task verbs,
// plus a file the task hasn't touched, or no telling word in common with it.
const PLAIN =
  /^(fix|add|create|build|implement|change|refactor|write|make|update|remove|delete|rename|move|migrate|generate|debug|convert|replace|please|also|again|this|that|file|code|test|tests|src|ts|js|tsx|jsx|py|now|still|then)$/;
function newTask(s: Session, prompt: string): boolean {
  if (wantsExplain(prompt) || wantsBrainstorm(prompt)) return true;
  if (classifyMessage(prompt) !== "task") return false;
  const known = new Set(tokens([s.task ?? "", ...s.touched.map((t) => t.path)].join(" ")));
  const words = tokens(prompt);
  if (words.some((w) => /[./]/.test(w) && !known.has(w))) return true; // a file it hasn't touched
  const telling = words.filter((w) => w.length > 3 && !PLAIN.test(w) && !/[./]/.test(w));
  return !telling.some((w) => known.has(w));
}

const hintRule = (hints: string[]) =>
  `Use exactly these options: ${hints.map((h) => `"${h}"`).join(", ")}; the user can also type their own answer.`;

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
// Copilot's camelCase event names; it also accepts the PascalCase ones skarp's files use
const EVENTS: Record<string, string> = {
  sessionStart: "SessionStart",
  userPromptSubmitted: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  agentStop: "Stop",
};

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
    hook_event_name: ((n) => EVENTS[n] ?? n)(
      String(raw.hook_event_name ?? raw.hookEventName ?? event ?? ""),
    ),
    tool_name: (raw.tool_name ?? raw.toolName) as string | undefined,
    tool_input: args as HookInput["tool_input"],
    // Copilot CLI harness: tool_result; Copilot's hooks reference: toolResult
    tool_response: raw.tool_response ?? raw.tool_result ?? raw.toolResult,
    transcript_path: (raw.transcript_path ?? raw.transcriptPath) as string | undefined,
    raw,
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
export function askRule(
  question: string,
  reason: string,
  options: string,
  level: boolean,
  check = false,
): string {
  return `${[
    "skarp rule, before anything else: ask the user with your question tool (AskUserQuestion in Claude Code, askQuestions in VS Code), so they get a question card.",
    `Question 1, header "skarp": "${question}" (${reason}) Options: ${options} Then a last option labelled "Skip" described as "Go ahead without answering; skarp logs it as owed".`,
    check
      ? 'Question 2, header "Check": "What would show it\'s fixed?" with options "A test passes", "I\'ll try it by hand", "Not sure"; the user can also type their own.'
      : "",
    level
      ? `Question ${check ? 3 : 2}, header "Level": "Your level, so skarp's explanations fit you?" with options "beginner", "intermediate", "advanced".`
      : "",
    "If that tool is not loaded, load it with ToolSearch first, without telling the user about it. If no question tool is available at all, write the question and options as text and stop; the user's next message is the answer.",
    "Do not read files, run commands or start the work until the user answers; skarp refuses other tools until then. After the answer, do what the user asked.",
  ]
    .filter(Boolean)
    .join("\n")}\n`;
}

// What skarp tells the AI once per session; each turn's rules still ride on the hooks that
// Copilot honors (deny reasons, the Stop send-back)
export function standingRules(level: Level): string {
  return [
    "skarp is on in this session. It checks your work with hooks; follow its rules when they appear.",
    "When the user gives a task or asks for an explanation, skarp asks its question first: use your question tool (AskUserQuestion in Claude Code, askQuestions in VS Code), or write it as text and stop.",
    reportRules(level),
    `When the user asks you to explain code (no change), use the explain report instead:\n${explainRules()}`,
    `When the user wants to brainstorm, skarp asks for their idea first, then you follow these rules every turn:\n${brainstormRules("you-first", false)}`,
  ].join("\n");
}

function startContext(text: string) {
  // both shapes: hookSpecificOutput for Claude Code, top-level for Copilot
  return {
    additionalContext: text,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  };
}

// The report part of a reply, saved as its own file and pointed to from the ledger.
function saveReport(
  home: string,
  kind: string,
  reply: string,
  log: (type: string, payload: object) => void,
) {
  const at = reply.indexOf("## skarp:");
  if (at < 0) return;
  try {
    const dir = join(home, "reports");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(
      dir,
      `${new Date().toISOString().slice(0, 10)}-${kind}-${randomUUID().slice(0, 8)}.md`,
    );
    writeFileSync(path, `${reply.slice(at).trim()}\n`, { mode: 0o600 });
    log("report", { kind, path });
  } catch {}
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
