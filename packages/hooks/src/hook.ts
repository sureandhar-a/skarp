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
  BLOCKS,
  checkAnswer,
  checkReply,
  classifyMessage,
  conceptOf,
  decideNextStep,
  isTestFile,
  matchConcept,
  type Outcome,
  overlap,
  rungFor,
  saysNotYet,
  tokens,
  wantsBrainstorm,
  wantsExplain,
} from "@skarp/kernel";
import {
  BIG_PICTURE_HINTS,
  BS_DECIDE,
  BS_QUESTION,
  BUILD_IT,
  brainstormFixes,
  brainstormRules,
  brainstormSummary,
  cardFixes,
  DECIDE,
  DONE_FOR_NOW,
  DONE_LISTING,
  HEAR_REPORT,
  hearRetry,
  hearRules,
  highStakes,
  hintsFor,
  MAX_RETELLS,
  type MapEvent,
  type Mode,
  OVERVIEW_REPORT,
  optionsOk,
  overviewRules,
  PART_HINTS,
  PART_REPORT,
  type Phase,
  parseMap,
  partRules,
  partsIn,
  RESUME,
  type ReportShape,
  TASK_REPORT,
  UNLOCK,
  understoodQuestion,
  understoodRules,
} from "./modes.ts";

export type Level = "beginner" | "intermediate" | "advanced";

interface Session {
  // skarp's question, not yet answered; options are the numbered choices the AI wrote as text
  asking?: {
    block: string;
    question: string;
    level: boolean;
    options?: string[];
    fixed?: number;
    fact?: string; // X8: the file:line recalled
    ref?: string; // X1: the owed line it clears
  };
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
  und?: Understand; // the open walk-through of something the user wants to understand
  refusedCard?: boolean; // skarp just refused a question card: its failure isn't a skip
  bs?: Brainstorm; // the open brainstorm
  lastDecision?: string; // the last brainstorm's decision: "build it" starts it as a task
  buildAfter?: boolean; // "build it" came before the decision: the build starts once it's recorded
  check?: string; // for a bug: what the user says would show it's fixed
  closing?: boolean; // the user said it's done: the report is due this turn
  lastExplain?: string; // the last explanation's request: "build it" starts a task from it
  blockReason?: string; // skarp's last Stop send-back: Copilot replays it as a user prompt
  // Hear before building (framework §7 Gap, §18): view = skarp's Commit question waits; stand =
  // the AI's walkthrough is due; fill = the user's K8 fill is due; build = writes allowed
  hear?: "view" | "stand" | "fill" | "build";
  rung?: number; // this area's fading rung: 1 = a short walkthrough, 2 = Hear is silent
  rounds?: number; // missed fills so far
  standText?: string; // the walkthrough, for the copy check
  blank?: string; // the K8 statement with its ___
  fact?: string; // the file:line the blank cites: the ledger fact the fill is checked against
  returned?: boolean; // this chat's opening Return ran (framework rule 3)
  next?: Ask; // the Commit question that follows the opening Return
}

// Understanding a target (framework §18, D179-D185): the big picture, then one part at a time
interface Understand {
  step: "overview" | "orient" | "part" | "next" | "end";
  target: string;
  parts: string[]; // the parts the big picture named
  part?: string; // the part now explained
  retells: number; // "Not understood" so far on this step (D180)
  results: { part: string; result: string }[];
  fixed?: number; // cards refused on this step
}

// a Commit ask, kept to be asked after the opening Return
interface Ask {
  block: string;
  question: string;
  reason: string;
  level: boolean;
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
  pending?: string; // a high-stakes pick waiting for its pre-mortem before it's recorded
}

const DEPTH: Record<Level, string> = {
  beginner:
    "The user is a beginner: explain every term you use, assume little background, and walk through the key code line by line.",
  intermediate: "The user is intermediate: explain the key ideas and skip the basics.",
  advanced: "The user is advanced: be brief and focus on design choices, trade-offs and risks.",
};
export const SECTIONS = TASK_REPORT.sections;
// what the AI may use while skarp's question waits: the card, and the search that loads it
// Claude Code's AskUserQuestion, VS Code's askQuestions (vscode/askQuestions, ask_questions),
// Copilot agent's ask_user (seen 26 Oct, VS Code 1.143)
const ASK_TOOL = /^AskUserQuestion$|ask_?questions|^ask_?user$/i;
const ASK_NAMES = "AskUserQuestion in Claude Code, ask_user or askQuestions in VS Code";
const ASKING_TOOLS = (tool: string) => ASK_TOOL.test(tool) || tool === "ToolSearch";
const RUNS = /^(Bash|run_in_terminal|runInTerminal)$|terminal/i; // shell tools, Claude and VS Code
const WRITES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// a test runner at the start of a command or after && / || / ; (not "cat cart.test.js")
const TEST_RUN =
  /(?:^|&&|\|\||;)\s*(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|npx\s+(?:vitest|jest|mocha)\b|(?:vitest|jest|mocha|pytest|rspec|phpunit)\b|python3?\s+-m\s+(?:pytest|unittest)\b|node\s+--test\b|(?:go|cargo|deno|dotnet|make)\s+test\b)/;
// after the test runner, `| tail`, `; echo` or `|| true` set the exit code, not the tests;
// `&& next` doesn't, since it only runs when the tests passed
const HIDES_EXIT = /;|\|/;
// praise the kernel's list misses
const MORE_PRAISE =
  /\b(nice (idea|work|job|plan)|awesome|amazing|you nailed it|great (job|work|idea|plan|choice))\b/i;
// referee checks that make sense on a report; the rest need the in-app chat loop
const REPORT_FAILS: Record<string, string> = {
  praise: "Remove the praise; state facts only.",
  unbacked_action:
    "You say you added or did something that the changed files don't show. Say only what the changes contain.",
  test_only:
    "This bug fix changed only test files. Say plainly whether the bug in the code is still there, and what would fix it in the code.",
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
    'Kept (run summary, A10): the one or two ideas from this task worth keeping, each with its file:line. Not yet: each skarp question the user skipped or put off in this task, or "Nothing."',
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
  // the user's message is logged just before skarp's next line, so it carries the id of the
  // work it opens or continues
  let pendingMsg: object | undefined;
  const log = (type: string, payload: object) => {
    if (type === "user_message") {
      pendingMsg = payload;
      return;
    }
    if (pendingMsg) {
      const msg = pendingMsg;
      pendingMsg = undefined;
      writeLine("user_message", msg);
    }
    if (type) writeLine(type, payload);
  };
  const writeLine = (type: string, payload: object) => {
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
  // send the AI back once; remember the reason, since Copilot feeds it back as a user prompt
  const sendBack = (reason: string) => {
    Object.assign(s, { sentBack: true, blockReason: reason });
    save();
    return { decision: "block", reason };
  };
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
  const levelNow = (): Level =>
    read<{ level?: Level }>(join(home, "profile.json"))?.level ?? "intermediate";
  // Fly (framework §4): the AI builds. X6, a prediction while it works, needs the app's live
  // card, so it is logged as silence; the Commit answer is graded against the diff at the end.
  const toBuild = () => {
    Object.assign(s, { hear: "build", asking: undefined, sentBack: false });
    log("silence", {
      intent: "fly",
      reason: "X6 needs the in-app card; the plan is graded against the diff",
    });
  };
  // after the Commit answer (or its skip): Hear on ground the user hasn't proven, else silence
  const startHear = (): string | undefined => {
    if (s.mode !== "task" || s.hear !== "view") return undefined;
    if ((s.rung ?? 0) >= 2) {
      log("silence", {
        intent: "hear",
        reason: "Shown on two days in two shapes; skarp stays quiet here.",
      });
      toBuild();
      return undefined;
    }
    Object.assign(s, { hear: "stand", rounds: 0, sentBack: false });
    log("hear_start", { block: "K8", light: s.rung === 1 });
    return hearRules(s.answer, levelNow(), s.rung === 1);
  };
  // the opening Return's answer (X8 recall or X1 owed), then the Commit question
  const afterReturn = (asked: NonNullable<Session["asking"]>, said: string | undefined) => {
    const skipped = said === undefined || /^(skip|not yet)\b/i.test(said.trim());
    if (asked.block === "X8") {
      // "not sure" is a "not yet" debt (D54), not a miss
      const unsure = !skipped && saysNotYet(said);
      const fails =
        skipped || unsure ? [] : checkAnswer(said, factEvidence(input.cwd, asked.fact, ""), "");
      const result = skipped ? "skipped" : unsure ? "not_yet" : fails.length ? "miss" : "pass";
      log("recall", { fact: asked.fact, result, fails });
      if (skipped || unsure) log("owed", { block: "X8", question: asked.question });
    } else {
      log(skipped ? "answer_skipped" : "answer", { block: "X1", text: said, ref: asked.ref });
      if (!skipped) log("owed_cleared", { ref: asked.ref });
    }
    const next = s.next;
    s.next = undefined;
    const feedback =
      asked.block === "X8" && !skipped && !saysNotYet(said)
        ? `The user's recall: "${said}". In one line, say what in it matches the code at ${asked.fact} and what is missing, citing the line. Never say 'correct'.\n`
        : "";
    if (!next) {
      s.asking = undefined;
      const hear = startHear();
      return `${feedback}${hear ?? `Now do the user's task: ${s.task}\n${rulesFor(s, levelNow())}`}`;
    }
    s.asking = { block: next.block, question: next.question, level: next.level };
    s.block = next.block;
    log("ask", { block: next.block, reason: next.reason });
    return `${feedback}${askRule(next.question, next.reason, hintRule(hintsFor(next.block)), next.level, next.block === BUG_BLOCK)}`;
  };

  // understand: a card's answer moves the walk-through on, and says what the AI does next
  const undGo = (u: Understand, step: Understand["step"], part?: string): string => {
    Object.assign(u, { step, retells: 0, fixed: 0 }, part ? { part } : {});
    const due: Record<string, [string, string]> = {
      orient: ["O1", BLOCKS.O1.question_text],
      next: ["O2", BLOCKS.O2.question_text],
      end: ["A10", understoodQuestion(u.target)],
    };
    const card = due[step];
    s.asking = card ? { block: card[0], question: card[1], level: false } : undefined;
    s.sentBack = false;
    log("understand_step", { step, part: u.part });
    return understandRules(u, levelNow());
  };
  // "Not understood": the same step again from a new angle (D180)
  const retell = (u: Understand): string => {
    u.retells++;
    Object.assign(s, { asking: undefined, sentBack: false });
    log("retell", { step: u.step, part: u.part, round: u.retells });
    return understandRules(u, levelNow());
  };
  const undAnswer = (u: Understand, said: string | undefined): string => {
    const block = s.asking?.block ?? "";
    const text = said?.trim() ?? "";
    const skipped = said === undefined || /^(skip|not yet)\b/i.test(text);
    const lost = !skipped && /^not understood\b/i.test(text);
    log(skipped ? "answer_skipped" : "answer", { block, text: said });
    s.asking = undefined;
    if (block === "O0") {
      if (lost && u.retells < MAX_RETELLS) return retell(u);
      if (lost) log("still_unclear", { block });
      // one part skips "Where do we start?"
      return u.parts.length > 1 ? undGo(u, "orient") : undGo(u, "part", u.parts[0] ?? u.target);
    }
    if (block === "O1" || block === "O2") {
      if (block === "O2" && (skipped || /^done for now\b/i.test(text))) return undGo(u, "end");
      const low = text.toLowerCase();
      const pick = u.parts.find(
        (p) => low && (low.includes(p.toLowerCase()) || p.toLowerCase().includes(low)),
      );
      return undGo(u, "part", pick ?? openParts(u)[0] ?? (text || u.target));
    }
    if (block === "K8") {
      if (lost && u.retells < MAX_RETELLS) return retell(u);
      const result = skipped ? "put off" : lost ? "still unclear" : "answered";
      if (skipped) log("owed", { block: "K8", question: s.blank ?? "" });
      u.results.push({ part: u.part ?? u.target, result });
      log("understand_check", { block: "K8", part: u.part, fact: s.fact, result });
      return openParts(u).length ? undGo(u, "next") : undGo(u, "end");
    }
    // A10, the closing recall: the walk-through is done (D185)
    if (skipped) log("owed", { block: "A10", question: understoodQuestion(u.target) });
    Object.assign(s, { und: undefined, mode: undefined, reportDue: false, lastExplain: u.target });
    return skipped
      ? "The user put the closing recall off; skarp keeps it as owed. Say so in one line."
      : `The user's one line: "${said}". In one or two lines, say what in it matches what was covered and what is missing, citing a file. Never say 'correct'; no praise.`;
  };

  if (event === "UserPromptSubmit") {
    try {
      return onPrompt();
    } finally {
      log("", {}); // flushes a user_message no other line followed
    }
  }
  function onPrompt(): object | undefined {
    const prompt: string = input.prompt ?? "";
    const said = prompt.trim();
    // skarp's own send-back, replayed by Copilot as a user message: the AI acts on it, skarp
    // doesn't take it as the user's words
    if (s.blockReason && said.startsWith(s.blockReason.trim().slice(0, 60))) {
      s.blockReason = undefined;
      save();
      log("send_back_replayed", {});
      return undefined;
    }
    const level = levelIn(prompt);
    if (level) setLevel(level);
    const owed = s.explainOwed
      ? "skarp: your last change has no complete skarp report yet. Give it first, then go on.\n"
      : "";
    // no question card on this surface: the AI wrote skarp's question as text, and this is the answer
    const asked = s.asking;
    const aside = (SMALL_TALK.test(said) && said.split(/\s+/).length <= 3) || said.endsWith("?");
    if ((asked?.block === "X8" || asked?.block === "X1") && !REPLACES.test(said) && !aside) {
      const note = afterReturn(asked, said);
      save();
      return context(note);
    }
    if (asked && !REPLACES.test(said)) {
      // "level advanced" on its own sets the level; it is not the answer
      if (level && !said.replace(LEVEL_SET, "").replace(/[\s.,!]/g, ""))
        return context(
          `The user set their level to ${level}. skarp's question is still waiting: "${asked.question}". Ask it again (question card, or as a numbered list) and stop.`,
        );
      // "thanks" or a question back is not an answer: skarp's question keeps waiting
      if (aside)
        return context(
          `skarp's question is still waiting: "${asked.question}". Reply to the user's message briefly, then ask skarp's question again (question card, or as text) and stop.`,
        );
      const skipped = /^(skip|not yet)\b/i.test(said);
      // "2" or "option 2" picks the second option the AI wrote
      const answer = said.replace(
        /^(?:option\s*)?(\d+)\b[.)]?/i,
        (m, n) => asked.options?.[Number(n) - 1] ?? m,
      );
      if (s.und) {
        const note = undAnswer(s.und, answer);
        save();
        return context(note);
      }
      if (skipped) {
        log("answer_skipped", { block: asked.block, via: "typed" });
        log("owed", { block: asked.block, question: asked.question });
      } else log("answer", { block: asked.block, text: answer, via: "typed" });
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
      const hear = startHear();
      save();
      if (hear)
        return context(
          `${skipped ? "The user skipped skarp's question." : `The user's answer to skarp's question "${asked.question}": ${answer}`}\n${hear}`,
        );
      return context(
        `${skipped ? "The user skipped skarp's question." : `The user's answer to skarp's question "${asked.question}": ${answer}`}\n${s.mode === "explain" ? "Now explain" : "Now do the user's task"}: ${s.task}\n${rulesFor(s, lvl ?? profile.level ?? "intermediate")}`,
      );
    }
    // a different task while Hear is under way starts fresh
    // a message that copies the walkthrough is an answer to it (a copied fill), not a new task
    const pasted =
      s.hear === "fill" && checkAnswer(prompt, "", s.standText ?? "").includes("copied");
    const waiting = s.mode === "task" && !REPLACES.test(said) && (pasted || !newTask(s, prompt));
    // the walkthrough hasn't come yet: it comes first, whatever the message
    if (waiting && s.hear === "stand") {
      s.sentBack = false;
      save();
      log("hear_waiting", {});
      return context(
        `Reply to the user's message briefly. skarp still needs the walkthrough before any change.\n${hearRules(s.answer, levelNow(), s.rung === 1)}`,
      );
    }
    // the user's fill for the K8 blank, checked against the line it cites
    if (waiting && s.hear === "fill") {
      const task = s.task ?? "";
      if (/^(skip|not yet)\b/i.test(said)) {
        log("hear_check", { block: "K8", fact: s.fact, result: "not_yet" });
        log("owed", { block: "K8", question: s.blank ?? "" });
        toBuild();
        save();
        return context(
          `The user put the gap off ("not yet"; skarp keeps it as owed). Now do the user's task: ${task}\n${rulesFor(s, levelNow())}`,
        );
      }
      // the cited line as the code says it now; if it can't be read, the walkthrough stands in
      const lines = factLines(input.cwd, s.fact);
      const evidence = factEvidence(input.cwd, s.fact, s.standText ?? "");
      // "I don't know" is a "not yet" debt (framework D54): owed, the plain answer, then the build
      if (saysNotYet(prompt)) {
        log("hear_check", { block: "K8", fact: s.fact, result: "not_yet", reason: "not sure" });
        log("owed", { block: "K8", question: s.blank ?? "" });
        toBuild();
        save();
        return context(
          `The user isn't sure yet (skarp keeps the gap as owed; it comes back later). Give the plain answer in two or three lines, citing ${s.fact ?? "the line"}, without judging them. Then do the user's task: ${task}\n${rulesFor(s, levelNow())}`,
        );
      }
      const fails = checkAnswer(prompt, evidence, s.standText ?? "");
      if (fails.includes("empty") || fails.includes("injection")) {
        save();
        return context(
          `The user's message doesn't fill the gap. Reply briefly, then ask them again to fill in: "${s.blank ?? "the blank"}". Do not change files.`,
        );
      }
      const round = s.rounds ?? 0;
      log("hear_check", {
        block: "K8",
        fact: s.fact,
        result: fails.length ? "miss" : "pass",
        fails,
        round,
        text: prompt,
        fact_read: lines !== undefined,
      });
      if (!fails.length) {
        toBuild();
        save();
        return context(
          `The user's fill: "${prompt}"\nIn one or two lines, say what in it matches the code at ${s.fact ?? "the cited line"} and what is missing. Never say 'correct'; no praise. Then do the user's task: ${task}\n${rulesFor(s, levelNow())}`,
        );
      }
      s.rounds = round + 1;
      // the second miss gets the plain answer and the work goes on; the gap comes back later
      if (s.rounds >= 2) {
        log("owed", { block: "K8", question: s.blank ?? "", reason: "missed twice" });
        toBuild();
      }
      save();
      return context(
        `${hearRetry(s.rounds, task)}${s.rounds >= 2 ? `\n${rulesFor(s, levelNow())}` : ""}`,
      );
    }
    Object.assign(s, { ran: false, testsPassed: undefined }); // a run counts for this turn only
    // "actually...": the waiting task is dropped
    if (asked) Object.assign(s, { asking: undefined, reportDue: false, mode: undefined });
    save();
    log("user_message", { text: prompt });
    const askLevel = !profile.level && !level;
    let decided: string | undefined; // the decision just recorded, when the build follows it
    // an open brainstorm: every message is part of it until a decision, or "actually / new task"
    if (s.mode === "brainstorm" && s.bs) {
      const ending = END_BS.test(said);
      if (RESUME.test(said) && !ending)
        return context(
          `This continues the open brainstorm.\n${brainstormRules(s.bs.phase, s.bs.stakes)}`,
        );
      if (!REPLACES.test(said) && !ending) {
        const note = brainstormTurn(s, s.bs, prompt, home, log);
        save();
        // "build it" came before the decision: now that it's recorded, the build starts (below)
        if (s.buildAfter && s.lastDecision) decided = note;
        else return context(note);
      }
      if (!decided) {
        const path = closeBrainstorm(s, s.bs, home, log);
        save();
        // "end brainstorm" only ends it; "actually, ..." goes on as new work
        if (ending)
          return context(
            `The user ended the brainstorm without a decision${path ? `; it is saved to ${path}` : ""}. In two lines, list the ideas still open and say that "continue the brainstorm on <topic>" picks it up again. No praise.`,
          );
      }
    }
    // an open task carries on across turns ("still failing", "try the other file") until it's done
    const lvl = level ?? profile.level ?? "intermediate";
    // "still failing" after the report: the last task wasn't done after all
    if (s.mode === "task" && !s.reportDue && s.task !== undefined && STILL.test(said)) {
      Object.assign(s, { reportDue: true, closing: false, sentBack: false });
      log("task_reopened", {});
      save();
      return context(
        `${owed}The user says the last task isn't done: ${s.task}\n${rulesFor(s, lvl)}`,
      );
    }
    const open = s.mode === "task" && s.reportDue && s.task !== undefined;
    // chat with nothing changed yet doesn't drag the task's rules along
    const offTopic =
      !s.touched.length &&
      !STILL.test(said) &&
      classifyMessage(prompt) !== "task" &&
      !related(s, prompt);
    const done = isDone(said);
    if (open && !REPLACES.test(said) && !offTopic && (done || !newTask(s, prompt))) {
      if (done) {
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
    if (s.lastDecision && (BUILD_IT.test(said) || decided)) {
      const decision = s.lastDecision;
      const before = `${owed}${decided ? `${decided}\n` : ""}`;
      s.buildAfter = false;
      Object.assign(s, fresh(`Build the brainstorm's decision: ${decision}`, "task"), {
        answer: decision,
        block: "brainstorm",
        lastDecision: undefined,
      });
      log("answer", { block: "brainstorm", text: decision, via: "decision" });
      Object.assign(s, { hear: "stand", rounds: 0 });
      log("hear_start", { block: "K8", light: false });
      save();
      return context(
        `${before}The user wants the brainstorm's decision built: ${decision}\n${hearRules(decision, levelNow(), false)}`,
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
    // understand: the big picture first, then one part at a time; no files change (D179-D185)
    if (wantsExplain(prompt) && !BUILD_IT.test(said)) {
      const u: Understand = {
        step: "overview",
        target: targetOf(prompt),
        parts: [],
        retells: 0,
        results: [],
      };
      Object.assign(s, fresh(prompt, "explain"), { und: u });
      log("understand_step", { step: "overview" });
      save();
      return context(`${owed}${understandRules(u, level ?? profile.level ?? "intermediate")}`);
    }
    const outcomes = readOutcomes(home);
    const concept = matchConcept(prompt, [...new Set(outcomes.map((o) => o.concept))]);
    const rung = concept ? rungFor(concept, outcomes) : 0;
    // every chat opens with Return (rule 3): a recall that's due, or a question put off before
    const due =
      !s.returned && classifyMessage(prompt) === "task" ? dueFor(home, input.cwd, sid) : undefined;
    const pick = (returned: boolean) =>
      decideNextStep({
        pause: "start",
        text: prompt,
        // picking a piece to study needs the in-app chat; not in hooks
        satisfiedIntents: returned ? ["orient", "return"] : ["orient"],
        rung,
        due: due?.block === "X8" ? due.fact : undefined,
        owedBefore: due?.block === "X1",
      });
    const opening = pick(Boolean(s.returned));
    const step =
      opening.action === "ask" && opening.block.intent === "return" ? pick(true) : opening;
    if (step.action === "continue" && step.silence) log("silence", step.silence);
    if (step.action !== "ask" && classifyMessage(prompt) !== "task") {
      return owed ? context(owed) : undefined;
    }
    // a task: the report is owed at Stop, whether skarp asks first or stays quiet (faded)
    // "build it" right after an explanation builds on what was explained
    const after = s.lastExplain && BUILD_IT.test(said) ? s.lastExplain : undefined;
    const built = after ? `${prompt} (what was explained: ${after})` : prompt;
    const from = after ? `This builds on the explanation the user asked for: ${after}\n` : "";
    Object.assign(s, fresh(built, "task"), { lastExplain: undefined, hear: "view", rung });
    let ask = "";
    // a proven area: Commit is silent, so Hear is decided now (silent too at rung 2)
    if (step.action !== "ask") ask = startHear() ?? "";
    if (ask) ask += "\n";
    if (opening.action === "ask" && opening.block.intent === "return" && due) {
      s.returned = true;
      s.next =
        step.action === "ask"
          ? {
              block: step.block.id,
              question: step.block.question_text,
              reason: step.reason,
              level: askLevel,
            }
          : undefined;
      s.asking = {
        block: due.block,
        question: due.question,
        level: false,
        fact: due.fact,
        ref: due.ref,
      };
      s.block = due.block;
      log("ask", { block: due.block, reason: opening.reason });
      save();
      return context(
        `${owed}${from}${askRule(due.question, opening.reason, hintRule(hintsFor(due.block)), false)}${rulesFor(s, level ?? profile.level ?? "intermediate")}`,
      );
    }
    s.returned = true;
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
    return context(`${owed}${from}${ask}${rulesFor(s, level ?? profile.level ?? "intermediate")}`);
  }

  // understand's cards: O0 and K8 come at the end of a step the AI writes; O1, O2 and A10 are due
  if (event === "PreToolUse" && s.und && ASK_TOOL.test(input.tool_name ?? "")) {
    const u = s.und;
    let card: { block: string; question: string } | undefined = s.asking;
    let fixes: string[] = [];
    if (card?.block === "O1" && !u.parts.length) u.parts = cardOptions(input.tool_input);
    if (card) fixes = cardFixes(input.tool_input, card.question, cardHints(u, card.block));
    else if (u.step === "overview") {
      card = { block: "O0", question: BLOCKS.O0.question_text };
      fixes = cardFixes(input.tool_input, card.question, BIG_PICTURE_HINTS);
      // the parts the big picture named, when this agent's transcript can be read
      const named = partsIn(lastAssistantText(input.transcript_path) ?? "");
      if (named.length) u.parts = named;
    } else if (u.step === "part") {
      // the card asks the part's blank itself, so the fill can be checked against its line
      const k8 = blankIn(`### Fill the gap\n${cardQuestion(input.tool_input)}`);
      card = { block: "K8", question: k8?.blank ?? "" };
      fixes = [
        ...(k8
          ? []
          : [
              "Ask your Fill the gap statement as the question: one statement ending in ___, then the file:line that shows the answer.",
            ]),
        ...cardFixes(input.tool_input, "", PART_HINTS),
      ];
      if (k8) Object.assign(s, k8);
    }
    if (!card) return undefined;
    if (fixes.length && (u.fixed ?? 0) < 2) {
      u.fixed = (u.fixed ?? 0) + 1;
      s.refusedCard = true;
      log("card_refused", { block: card.block, fixes });
      save();
      return deny(`skarp: fix the question card.\n- ${fixes.join("\n- ")}`);
    }
    u.fixed = 0;
    s.asking = { block: card.block, question: card.question, level: false };
    log("ask", { block: card.block, reason: "understand" });
    save();
    return undefined;
  }

  // until skarp's question is answered, every other tool waits
  // the card must ask skarp's question with skarp's options: the user's view comes first
  if (event === "PreToolUse" && s.asking && ASK_TOOL.test(input.tool_name ?? "")) {
    const fixes = cardFixes(input.tool_input, s.asking.question, hintsFor(s.asking.block));
    if (fixes.length && (s.asking.fixed ?? 0) < 2) {
      s.asking.fixed = (s.asking.fixed ?? 0) + 1;
      s.refusedCard = true;
      log("card_refused", { block: s.asking.block, fixes });
      save();
      return deny(`skarp: fix the question card.\n- ${fixes.join("\n- ")}`);
    }
    return undefined;
  }
  if (event === "PreToolUse" && s.asking && !ASKING_TOOLS(input.tool_name ?? "")) {
    return deny(
      // the rules ride along: Copilot drops UserPromptSubmit context, so this is all it sees of them
      `skarp: ask the user skarp's question with your question tool first (${ASK_NAMES}): "${s.asking.question}". Nothing else runs until they answer.\nAfter the answer:\n${rulesFor(s, profile.level ?? "intermediate")}`,
    );
  }

  // a card skarp refused may come back as a failed tool: that's not the user skipping it
  if (event === "PostToolUseFailure" && ASK_TOOL.test(input.tool_name ?? "") && s.refusedCard) {
    s.refusedCard = false;
    save();
    return undefined;
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
    const post = (note: string) => ({
      additionalContext: note,
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note },
    });
    s.refusedCard = false;
    if (s.und) {
      const note = undAnswer(s.und, event === "PostToolUseFailure" ? undefined : commit);
      save();
      return post(note);
    }
    if (asked.block === "X8" || asked.block === "X1") {
      const note = afterReturn(asked, event === "PostToolUseFailure" ? undefined : commit);
      save();
      return post(note);
    }
    // a one-question card (Copilot) has no level answer: leave it unset rather than guess
    if (asked.level && event === "PostToolUse" && answers.length > 1)
      setLevel(answers.slice(1).map(levelAnswer).find(Boolean) ?? "intermediate");
    if (event === "PostToolUseFailure" || commit === undefined) {
      // fail open (rule 17): no question card on this surface, so the task goes on, logged as owed
      log("answer_skipped", { block: asked.block, reason: "question tool unavailable" });
    } else if (/^skip\b/i.test(commit.trim())) {
      log("answer_skipped", { block: asked.block });
      log("owed", { block: asked.block, question: asked.question });
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
      return post(note);
    }
    const hear = startHear();
    save();
    return hear ? post(hear) : undefined;
  }

  const files = event === "PreToolUse" ? writtenFiles(input) : [];
  if (files.length && s.mode === "task" && (s.hear === "stand" || s.hear === "fill"))
    return deny(
      `skarp Hear: no file changes until the user has filled the gap.\n${
        s.hear === "stand"
          ? hearRules(s.answer, levelNow(), s.rung === 1)
          : s.rounds
            ? hearRetry(s.rounds, s.task ?? "") // Copilot drops the prompt hook's note: it rides here
            : `Wait for the user's fill of: "${s.blank ?? "the blank"}".`
      }`,
    );
  if (files.length && ((s.reportDue && s.mode === "explain") || s.mode === "brainstorm"))
    return deny(
      `skarp: ${s.mode} mode changes no files. Finish the ${s.mode === "explain" ? "explanation" : "brainstorm"}; if the user wants a change, they say 'build it' and it becomes a task.`,
    );
  if (files.length) {
    // a write the classifier didn't call a task: like any task, Commit first, then Hear
    if (!s.reportDue) {
      const b = BLOCKS["LS-B1"];
      Object.assign(s, fresh("the change the AI started without a task", "task"), {
        hear: "view",
        block: b.id,
        asking: { block: b.id, question: b.question_text, level: false },
      });
      log("ask", { block: b.id, reason: "a change skarp didn't see coming as a task" });
      save();
      return deny(
        `skarp: before this change, ${askRule(b.question_text, "Guess what the change will touch.", hintRule(hintsFor(b.id)), false)}`,
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
      const after = cmd.slice((cmd.match(TEST_RUN)?.index ?? 0) + 1);
      if (passed && HIDES_EXIT.test(after) && !/pipefail/.test(cmd)) passed = undefined;
      s.testsPassed = passed;
      log("run", { command: cmd, passed: passed ?? "unknown" });
    }
    save();
    return undefined;
  }

  // understand: each step the AI writes is checked, then its card is due
  if (event === "Stop" && s.und) {
    const u = s.und;
    const reply = input.last_assistant_message ?? lastAssistantText(input.transcript_path);
    const may = !s.sentBack && !input.stop_hook_active;
    // asked as text (no card here): the user's next message is the answer
    const asText = (q: string) => Boolean(q && reply?.toLowerCase().includes(q.toLowerCase()));
    if (s.asking) {
      if (may && !asText(s.asking.question))
        return sendBack(`skarp: ${understandRules(u, levelNow())}`);
      return undefined;
    }
    if (u.step !== "overview" && u.step !== "part") return undefined;
    const over = u.step === "overview";
    const fixes: string[] = [];
    if (reply === undefined)
      log("referee", { check: u.step, not_run: "no reply text on this surface" });
    else {
      fixes.push(...reportFixes(reply, over ? OVERVIEW_REPORT : PART_REPORT));
      const named = over ? partsIn(reply) : [];
      const k8 = over ? undefined : blankIn(reply);
      if (over && named.length) u.parts = named;
      if (k8) Object.assign(s, k8);
      if (!fixes.length && over && !named.length)
        fixes.push(
          "Under `### The main parts`, list each part as `- **Part name**: what it does (path)`.",
        );
      if (!fixes.length && !over && !k8)
        fixes.push(
          "Under `### Fill the gap`, write one statement ending in ___ followed by the file:line that shows the answer.",
        );
      log("referee", { check: u.step, fixes });
      if (fixes.length && may)
        return sendBack(
          `skarp understand check:\n- ${fixes.join("\n- ")}\n${understandRules(u, levelNow())}`,
        );
    }
    // the step is written but its card wasn't asked: it's due now, and a typed answer counts too
    const question = over ? BLOCKS.O0.question_text : (s.blank ?? "");
    s.asking = { block: over ? "O0" : "K8", question, level: false };
    save();
    if (may && !asText(question))
      return sendBack(`skarp: now ask the card. ${understandRules(u, levelNow())}`);
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
    if (fixes.length && !s.sentBack && !input.stop_hook_active)
      return sendBack(
        `skarp brainstorm check:\n- ${fixes.join("\n- ")}\n${brainstormRules(bs.phase, bs.stakes)}`,
      );
    // the turn as it stands goes on the record; ideas the AI raised stay marked as its own
    bsLog(home, bs, { kind: "turn", role: "ai", text: reply });
    for (const e of parseMap(reply)) {
      if (e.type === "idea" && e.by === "ai") bs.ideas++;
      if (!(e.type === "idea" && e.by === "you")) bsLog(home, bs, { kind: "map", ...e });
    }
    save();
    return undefined;
  }

  // Hear: the walkthrough and its K8 blank are required before the fill; writes stay refused
  if (
    event === "Stop" &&
    s.mode === "task" &&
    (s.hear === "stand" || s.hear === "fill") &&
    !s.asking
  ) {
    const reply = input.last_assistant_message ?? lastAssistantText(input.transcript_path);
    // skarp can't read the reply here, so it can't check the walkthrough: it doesn't hold the
    // work on its own failure (rules 6, 24: logged as not run)
    if (reply === undefined) {
      log("hear", { not_run: "no reply text on this surface" });
      toBuild();
      save();
      return undefined;
    }
    const k8 = blankIn(reply);
    // a retry after a missed fill brings only a new blank
    if (s.hear === "fill") {
      if (k8) Object.assign(s, k8);
      save();
      return undefined;
    }
    const fixes = [...reportFixes(reply, HEAR_REPORT), ...explainsCode(reply)];
    if (!fixes.length && !k8)
      fixes.push(
        "Under `### Fill the gap`, write one statement ending in ___ followed by the file:line that shows the answer.",
      );
    log("hear", { fixes });
    if (!fixes.length) {
      Object.assign(s, { hear: "fill", standText: reply, sentBack: false }, k8);
      log("ask", { block: "K8", reason: "Fill the gap in the walkthrough.", fact: k8?.fact });
      save();
      return undefined;
    }
    if (!s.sentBack && !input.stop_hook_active)
      return sendBack(
        `skarp Hear:\n- ${fixes.join("\n- ")}\n${hearRules(s.answer, levelNow(), s.rung === 1)}`,
      );
    save();
    return undefined;
  }

  if (event === "Stop" && s.mode !== "explain" && (s.reportDue || s.asking)) {
    if (s.asking) {
      if (!s.sentBack && !input.stop_hook_active)
        return sendBack(
          `skarp: ask the user skarp's question with your question tool first (${ASK_NAMES}; load it with ToolSearch if needed, without mentioning that to the user): "${s.asking.question}". If no question tool is available, write the question and its options as a numbered list (1., 2., ...) and stop; the user's next message is the answer.`,
        );
      // the AI wrote the question as text (no card here); the user's next message answers it,
      // maybe by number, so keep the options it wrote: numbered, else bulleted, in order
      const text = input.last_assistant_message ?? lastAssistantText(input.transcript_path) ?? "";
      const listed = (re: RegExp) =>
        [...text.matchAll(re)].map((m) => (m[1] ?? "").replace(/\*\*/g, "").trim());
      const numbered = listed(/^\s*(?:[-*]\s*)?\**\d+[.)]\**\s*(.+)$/gm);
      const options = numbered.length ? numbered : listed(/^\s*[-*•]\s+(.+)$/gm);
      if (options.length) {
        s.asking.options = options;
        save();
      }
      const hints = hintsFor(s.asking.block);
      // once, even on the Stop that follows the first send-back
      if (options.length && !optionsOk(options, hints) && !s.asking.fixed) {
        s.asking.fixed = 1;
        return sendBack(
          `skarp: ask skarp's question "${s.asking.question}" with exactly these options, as a numbered list: ${[...hints, "Skip"].map((h, i) => `${i + 1}. ${h}`).join(" ")}. Then stop; the user's next message is the answer.`,
        );
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
      if (!s.sentBack && !input.stop_hook_active)
        return sendBack(
          "skarp: you changed files but gave neither the report nor a status. If the task is done, give the full `## skarp: what changed` report; if not, end with `### skarp: status` (found so far, tried, next step).",
        );
    }
    saveReport(home, kind, reply, log);
    // the run summary (A10): what's kept goes on the record; the next recall grades it
    const kept = reply
      .split("### Kept")[1]
      ?.split(/\n#{2,3} /)[0]
      ?.trim();
    if (kind === "task" && kept) log("kept", { text: kept });
    const shape = reportFixes(reply, TASK_REPORT);
    const failed = new Set(
      checkReply(reply, undefined, [], {
        edited: s.touched.map((t) => t.path),
        heldText: s.touched.map((t) => t.content).join("\n"),
        ran: s.ran,
        testsPassed: s.testsPassed,
      }).filter((f) => f in REPORT_FAILS),
    );
    if (MORE_PRAISE.test(reply)) failed.add("praise");
    // a bug "fixed" by changing only tests may hide it (R21's concern, checked at the end)
    const paths = s.touched.map((t) => t.path);
    if (s.block === BUG_BLOCK && paths.length && paths.every(isTestFile)) failed.add("test_only");
    const fixes = [...shape, ...[...failed].map((f) => REPORT_FAILS[f])];
    log("referee", { check: "report", shape, failed: [...failed] });
    if (fixes.length && !s.sentBack && !input.stop_hook_active)
      return sendBack(`skarp report check:\n- ${fixes.join("\n- ")}`);

    const lines = grade(s, sid, log);
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
const END_BS = /^(end|stop|close|finish) (the |this |our )?brainstorm\b/i;
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
      if (BUILD_IT.test(text.trim())) s.buildAfter = true;
      if (bs.ideas < 2) {
        note =
          "The user wants to decide, but a decision needs at least two options. Ask for one more option, or whether doing nothing is the rival.";
      } else if (REASON.test(text) && !BUILD_IT.test(text.trim())) {
        if (!bs.stakes) return decide(s, bs, text, text, home, log);
        // hard to undo: the pre-mortem comes before the pick is recorded
        bs.phase = "decide";
        bs.pending = text;
        note = `The user picked: "${text}". Before skarp records it, write the pre-mortem and ask whether it changes their pick.`;
      } else {
        bs.phase = "decide";
        note = `The user wants to decide. Ask exactly: "${BS_DECIDE}"`;
      }
    } else note = "Go on with the stress test: one question at a time.";
  } else {
    // decide: the user's own words are the decision; a reason is required
    if (bs.pending) {
      // after the pre-mortem: a new pick replaces the waiting one, anything else keeps it
      const pick = DECIDE.test(text) ? text : bs.pending;
      return decide(s, bs, pick, pick, home, log);
    }
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
    und: undefined,
    check: undefined,
    closing: false,
    hear: undefined,
    rung: 0,
    rounds: 0,
    standText: undefined,
    blank: undefined,
    fact: undefined,
    next: undefined,
  };
}

// --- understand: what the AI does at each step, and the card that ends it ---

// the thing the user wants to understand, from their message
export function targetOf(prompt: string): string {
  const t = prompt.trim();
  const m = t.match(/\bhow does (.+?) work\b/i) ?? t.match(/\bwhat does (.+?) do\b/i);
  if (m?.[1]) return m[1].trim();
  const rest = t
    .replace(
      /^.*?\b(?:help me understand|understand|explain|walk me through|get to know|learn (?:how|about))\b\s*/i,
      "",
    )
    .replace(/\s*\bto me\b/i, "")
    .replace(/[?.!\s]+$/, "")
    .trim();
  return rest || t;
}

const cardRule = (question: string, options: string[], free = false) =>
  `Then ask the user with your question tool (${ASK_NAMES}), one question with header "skarp": ${question}, with these options: ${[...options, "Skip"].map((o) => `"${o}"`).join(", ")}${free ? "; the user can also type their own answer" : ""}. If that tool is not loaded, load it with ToolSearch first, without telling the user. If no question tool is available, write the question and its options as a numbered list and stop. Change no files.`;

const openParts = (u: Understand) => u.parts.filter((p) => !u.results.some((r) => r.part === p));

export function understandRules(u: Understand, level: Level): string {
  switch (u.step) {
    case "overview":
      return `${overviewRules(u.target, level, u.retells)}\n${cardRule(`"${BLOCKS.O0.question_text}"`, BIG_PICTURE_HINTS)}`;
    case "orient":
      return `skarp understand: the big picture is done; the user picks where to start. ${cardRule(`"${BLOCKS.O1.question_text}"`, u.parts)}`;
    case "part":
      return `${partRules(u.part ?? u.target, level, u.retells)}\n${cardRule("your Fill the gap statement, word for word, with its file:line", PART_HINTS, true)}`;
    case "next":
      return `skarp understand: the user picks the next part. ${cardRule(`"${BLOCKS.O2.question_text}"`, [...openParts(u), DONE_FOR_NOW])}`;
    case "end":
      return `${understoodRules(u.results, openParts(u))}\n${cardRule(`"${understoodQuestion(u.target)}"`, ["Not yet"], true)}`;
  }
}

// a card's question and options, Claude's { questions } or Copilot's ask_user { message }
function cardQuestion(input: unknown): string {
  const c = input as { questions?: { question?: string }[]; message?: string } | undefined;
  return c?.questions?.[0]?.question ?? c?.message ?? "";
}
function cardOptions(input: unknown): string[] {
  const c = input as
    | {
        questions?: { options?: ({ label?: string } | string)[] }[];
        requestedSchema?: { properties?: Record<string, { enum?: string[] }> };
      }
    | undefined;
  const labels =
    c?.questions?.[0]?.options?.map((o) => (typeof o === "string" ? o : (o.label ?? ""))) ??
    Object.values(c?.requestedSchema?.properties ?? {}).flatMap((f) => f.enum ?? []);
  return labels.filter((l) => l && !/^skip$/i.test(l)).slice(0, 4);
}
// the options a due card may offer
const cardHints = (u: Understand, block: string) =>
  block === "O1"
    ? u.parts
    : block === "O2"
      ? [...openParts(u), DONE_FOR_NOW]
      : block === "A10"
        ? ["Not yet"]
        : hintsFor(block);

// The rules for the open work, given after skarp's question (and in deny reasons for Copilot).
function rulesFor(s: Session, level: Level): string {
  if (s.und) return understandRules(s.und, level);
  return [
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
// "yep that fixed it", "ok works now": a short message that says it's done, with no "but" or "not"
const DONE_ANY =
  /\b(fixed|works( now)?|working now|that (did it|worked|fixed it)|all good|ship it|looks good|tests? pass(es)? now)\b/i;
const isDone = (said: string) =>
  DONE_TASK.test(said) ||
  (said.split(/\s+/).length <= 8 &&
    DONE_ANY.test(said) &&
    !/\b(not|n't|still|but|no)\b/i.test(said));
// "still failing", "nope, still broken": the fix didn't work
const STILL =
  /\b(still|again)\b[^.?!]{0,30}\b(fail\w*|broken|wrong|error\w*|crash\w*|not work\w*|doesn'?t work)\b|^(nope|no,? (it'?s )?still|didn'?t work|not fixed|doesn'?t work)\b/i;

// A message during an open task is a new task only when it names different work: task verbs,
// plus a file the task hasn't touched, or no telling word in common with it.
const PLAIN =
  /^(fix|add|create|build|implement|change|refactor|write|make|update|remove|delete|rename|move|migrate|generate|debug|convert|replace|please|also|again|this|that|file|code|test|tests|src|ts|js|tsx|jsx|py|now|still|then)$/;
function newTask(s: Session, prompt: string): boolean {
  if (wantsExplain(prompt) || wantsBrainstorm(prompt)) return true;
  if (classifyMessage(prompt) !== "task") return false;
  const known = taskWords(s);
  if (tokens(prompt).some((w) => /[./]/.test(w) && !known.has(w))) return true; // a file it hasn't touched
  return !related(s, prompt);
}
const taskWords = (s: Session) =>
  new Set(tokens([s.task ?? "", ...s.touched.map((t) => t.path)].join(" ")));
// the message shares a telling word with the open task
function related(s: Session, prompt: string): boolean {
  const known = taskWords(s);
  return tokens(prompt)
    .filter((w) => w.length > 3 && !PLAIN.test(w) && !/[./]/.test(w))
    .some((w) => known.has(w));
}

// The walkthrough must point at the code before the blank counts: a file or file:line in
// "What the code does now" and "What will change".
function explainsCode(reply: string): string[] {
  const at = reply.indexOf(HEAR_REPORT.head);
  if (at < 0) return [];
  const body = (name: string) =>
    reply
      .slice(at)
      .split(`### ${name}`)[1]
      ?.split(/\n#{2,3} /)[0] ?? "";
  return ["What the code does now", "What will change"]
    .filter((n) => body(n) && !/[\w-]+\.[a-z]{1,4}\b/i.test(body(n)))
    .map(
      (n) =>
        `Under \`### ${n}\`, explain it with the files involved (file:line), before the blank.`,
    );
}

// K8's blank in a walkthrough: the statement ending in ___ and the file:line it cites
const CITE = /([\w./-]+\.[a-z]{1,4}):(\d+)/i;
export function blankIn(reply: string): { blank: string; fact: string } | undefined {
  const at = reply.indexOf("### Fill the gap");
  if (at < 0) return undefined;
  const body = reply.slice(at + "### Fill the gap".length).split(/\n#{2,3} /)[0] ?? "";
  const line = body.split("\n").find((l) => /_{3,}/.test(l) && CITE.test(l));
  const cite = line?.match(CITE);
  return line && cite ? { blank: line.trim(), fact: `${cite[1]}:${cite[2]}` } : undefined;
}

// The ledger fact behind a blank or a recall: the cited line and two on each side, as the code
// says it now. Undefined when the file can't be read.
export function factLines(cwd: string | undefined, fact: string | undefined): string | undefined {
  const m = fact?.match(/^(.+):(\d+)$/);
  if (!m?.[1] || !m[2]) return undefined;
  try {
    const path = isAbsolute(m[1]) ? m[1] : join(cwd ?? ".", m[1]);
    const lines = readFileSync(path, "utf8").split("\n");
    const n = Number(m[2]) - 1;
    if (n < 0 || n >= lines.length) return undefined; // the line isn't there: no fact to check
    return lines.slice(Math.max(0, n - 2), n + 3).join("\n");
  } catch {
    return undefined;
  }
}

// Words every line of code has: a fill must name something of this line, not "function" or "return"
const KEYWORDS =
  /\b(function|return|const|let|var|export|import|from|default|if|else|for|while|do|switch|case|break|continue|class|new|this|self|true|false|null|undefined|none|def|async|await|try|catch|finally|throw|public|private|static|void|int|string|number|boolean|the|a|an|and|or|of|to|in|is|it)\b/gi;
// The evidence a fill or recall is checked against: the cited line's own names and values
export const factEvidence = (cwd: string | undefined, fact: string | undefined, fallback: string) =>
  (factLines(cwd, fact) ?? fallback).replace(KEYWORDS, " ");

// What the opening Return brings back (framework §6 Return, rule 3), from earlier chats in this
// project: a fill that passed is due for recall in a new form (X8); else a question put off (X1)
type Due = { block: "X8" | "X1"; question: string; fact?: string; ref?: string };
export function dueFor(home: string, cwd: string | undefined, sid: string): Due | undefined {
  let lines: { id: string; type: string; session_id?: string; payload: Record<string, unknown> }[];
  try {
    lines = readFileSync(join(home, "ledger", "hooks.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((l) => l.payload?.cwd === cwd);
  } catch {
    return undefined;
  }
  const recalled = new Set(lines.filter((l) => l.type === "recall").map((l) => l.payload.fact));
  const fill = lines
    .filter((l) => l.type === "hear_check" && l.payload.result === "pass" && l.session_id !== sid)
    .filter((l) => !recalled.has(l.payload.fact))
    .at(-1);
  if (typeof fill?.payload.fact === "string")
    return {
      block: "X8",
      question: `From last time: in your own words, what does the code at ${fill.payload.fact} do?`,
      fact: fill.payload.fact,
    };
  const cleared = new Set(lines.filter((l) => l.type === "owed_cleared").map((l) => l.payload.ref));
  const owed = lines
    .filter((l) => l.type === "owed" && l.session_id !== sid && !cleared.has(l.id))
    .at(-1);
  if (typeof owed?.payload.question === "string" && owed.payload.question)
    return {
      block: "X1",
      question: `Earlier you put this off: "${owed.payload.question}" Want to answer it now?`,
      ref: owed.id,
    };
  return undefined;
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
    const text = pass
      ? `skarp: your plan matched the change (${s.touched.length} file${s.touched.length > 1 ? "s" : ""}).`
      : `skarp: the change went where your plan didn't${missed.length ? `: ${missed.join(", ")}` : ""}.`;
    // the wording too: Copilot doesn't show Stop messages, so `skarp-copilot status` reads it here
    log("outcome", { ...o, score, text });
    lines.push(text);
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
  // Copilot: { text_result_for_llm | textResultForLlm: "User responded: X" | "User cancelled the request." }
  const c = v as { text_result_for_llm?: unknown; textResultForLlm?: unknown } | undefined;
  const said = c?.text_result_for_llm ?? c?.textResultForLlm;
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
    `skarp rule, before anything else: ask the user with your question tool (${ASK_NAMES}), so they get a question card.`,
    `Question 1, header "skarp": "${question}" (${reason}) Options: ${options} Then a last option labelled "Skip" described as "Go ahead without answering; skarp logs it as owed".`,
    check
      ? 'Question 2, header "Check": "What would show it\'s fixed?" with options "A test passes", "I\'ll try it by hand", "Not sure"; the user can also type their own.'
      : "",
    level
      ? `Question ${check ? 3 : 2}, header "Level": "Your level, so skarp's explanations fit you?" with options "beginner", "intermediate", "advanced".`
      : "",
    "If that tool is not loaded, load it with ToolSearch first, without telling the user about it. If no question tool is available at all, write the question and its options as a numbered list (1., 2., ...) and stop; the user's next message is the answer.",
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
    `When the user gives a task or asks for an explanation, skarp asks its question first: use your question tool (${ASK_NAMES}), or write it as a numbered list and stop.`,
    "Before you change any file for a task on ground the user hasn't proven, skarp has you walk them through it (`## skarp: where you stand`, ending with one blank to fill) and refuses writes until they fill it or put it off.",
    reportRules(level),
    `When the user asks you to explain or understand code (no change), skarp walks them through it one step at a time, starting with the big picture:\n${understandRules({ step: "overview", target: "what they asked about", parts: [], retells: 0, results: [] }, level)}`,
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
