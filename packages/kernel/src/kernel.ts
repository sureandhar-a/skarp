// The rules: block selector, gates, Referee checks, fallback ladder, fading, proof.

import type { Block, Intent } from "./blocks/base.ts";
import { BLOCKS } from "./blocks/starter.ts";
import type { Rung } from "./fading.ts";
import { ALIGNED, overlap } from "./gap.ts";

// Pure functions only: no files, network, clock, model or vscode (enforced by purity.test.ts).

// The pauses where skarp may ask.
export type Pause = "start" | "after_turn" | "before_run" | "finish";

export interface KernelInput {
  pause?: Pause; // default "start": a new user message, before the model sees it
  satisfiedIntents?: Intent[]; // e.g. ["commit"]
  text?: string; // the user's message; without it every message counts as a task
  owed?: boolean; // a skipped or "not yet" ask is waiting
  deepOptIn?: boolean; // "I have time" chat: one deep block allowed
  commitAnswer?: string; // what the user said at Commit
  touched?: { path: string; content: string; removed?: string[]; added?: string[] }[]; // edits the AI proposed this turn, with the lines they take out and put in
  command?: string; // the command about to run (before_run)
  rung?: Rung; // fading for this concept; 0 when unknown
  control?: boolean; // a control chat: only the closing Return is asked
  off?: boolean; // skarp off for this chat: nothing asked, nothing owed
  due?: string; // a recall due at chat start, e.g. "src/auth/a.ts:3 retries 3 times"
  owedBefore?: boolean; // a "not yet" from an earlier chat waits; it comes back first
  piece?: string; // understand: the piece the AI just explained, so a check follows
  grounded?: boolean; // after_turn: the AI looked at the project; cards anchor to it
  retry?: boolean; // the piece's check was just missed: ask the same idea in a new shape
  lighter?: boolean; // "lighter" on a Why line: asks in this chat become one-tap confirms
}

export type MessageKind = "chat" | "question" | "task" | "understand";

export type KernelOutput =
  | { action: "ask"; block: Block; reason: string } // reason is shown with the ask
  // silence: skarp chose not to ask, and why; core logs it
  | { action: "continue"; silence?: { intent: Intent; reason: string } };

// limit: word rules, not understanding. The Gap step only grades answers against changes.
const TASK_VERBS =
  /\b(fix|add|create|build|implement|change|refactor|write|make|update|remove|delete|rename|move|migrate|generate|set ?up|debug|convert|replace)\b/;
// a greeting, thanks or a go-ahead ("yes please, go ahead"), when that's all the message is
const CHAT =
  /^(hi|hey|hello|yo|thanks|thank you|thx|ok|okay|cool|nice|great|bye|good (morning|evening|night)|yes|yep|yeah|sure|go ahead|please do|do it|sounds good)\b/;
// "can you help", "could you look": a bug plus a request is a task, however politely it's put
const ASKS_HELP = /\b(help|can you|could you|would you|please|look at|sort (it|this) out)\b/;
const BUG =
  /\b(bug|error|fail(s|ing|ed)?|crash(es|ing)?|broken|exception|wrong|debug|not working)\b/;
const NAMES_CODE = /[\w-]+\.[a-z]{1,4}\b|\b[a-z]+[A-Z]\w*|\b\w+_\w+/; // file.ts, camelCase, snake_case
const HOW_IT_WORKS = /\b(how (does|do|is)|walk me through|explain)\b/;
const TEST_RUN = /\b(test|tests|unittest|jest|vitest|pytest|mocha|spec|rspec|nose2?)\b/;
// understand: a wish to understand plus a target to understand
const UNDERSTAND =
  /\b(understand|walk me through|explain|get to know|learn (how|about)|what does .{1,60} do|how does .{1,60} work)\b/;
const COMMIT_HASH = /\b[0-9a-f]{7,40}\b/;
const PATH = /(?:^|\s)([\w.-]+\/[\w./-]*|[\w-]+\.[a-z]{1,4})(?=[\s,.?!:;)]|$)/;
const WHOLE = /\b(this|the|my) (repo|repository|codebase|project|code base)\b/;
const LAST_COMMIT = /\b(this|the|my|last|latest) commit\b/;
// work that can't be taken back gets a read-back first, not a plan question
const DESTRUCTIVE =
  /\b(rm -rf?|git reset --hard|git push (-f|--force)|git clean -f\w*|drop (table|database)|truncate|delete (the|all|every)\b|wipe)\b/;
// "just change the test's expected value": challenged before the AI touches anything
const TEST_SHORTCUT =
  /\b(change|edit|update|modify|tweak|adjust)\b.{0,40}\btests?('s)?\b.{0,40}\b(expect\w*|assert\w*|value|to pass)\b|\bmake the tests? pass\b/;
// a change that takes out error handling or cleanup, or adds a raise, can break an
// invariant ("all or none") even when the test passes
const RISKY_OUT = /\b(except|finally|rollback|release|unlock|close|catch|revert|undo)\b/;
const RISKY_IN = /\b(raise|throw)\b/;
// a test file: its folder or its name says so
const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\/|(^|\/)test_[^/]*$|[._-](test|spec)\.\w+$/;
export const isTestFile = (path: string) => TEST_FILE.test(path);
const PREVIEW = /(--dry-run|\bexplain\b|\bplan\b|count\(|--check|--diff)/i;
// a lone read-only command: nothing to predict or break. Any chaining or redirect still gets asked.
const READ_ONLY =
  /^\s*(git\s+(show|log|diff|status|blame)|cat|ls|head|tail|grep|rg|wc|pwd|tree)\b[^;&|<>`$]*$/;

export function classifyMessage(text: string): MessageKind {
  const t = text.trim().toLowerCase();
  if (UNDERSTAND.test(t) && findTarget(text)) return "understand";
  if (DESTRUCTIVE.test(t)) return "task"; // "rm -rf node_modules and reinstall" gets its read-back
  if (TASK_VERBS.test(t) || (BUG.test(t) && ASKS_HELP.test(t))) return "task";
  if ((CHAT.test(t) && t.split(/\s+/).length <= 5) || t.split(/\s+/).length <= 2) return "chat";
  return "question";
}

// What an understand message points at; core turns it into files.
export type Target =
  | { kind: "commit"; ref: string }
  | { kind: "path"; path: string }
  | { kind: "repo" };

export function findTarget(text: string): Target | undefined {
  const hash = COMMIT_HASH.exec(text)?.[0];
  if (hash && /\d/.test(hash)) return { kind: "commit", ref: hash }; // a hash has a digit; "deadbeef" words don't
  const path = PATH.exec(text)?.[1]?.replace(/[./]+$/, "");
  if (path) return { kind: "path", path };
  const t = text.toLowerCase();
  if (LAST_COMMIT.test(t)) return { kind: "commit", ref: "HEAD" };
  if (WHOLE.test(t)) return { kind: "repo" };
  return undefined;
}

// an understand message that also asks for a change runs that task once understood
export const hasTask = (text: string) => TASK_VERBS.test(text.toLowerCase());

// explain: a wish to understand, with or without a target ("explain the repo to me"). A task
// verb only counts when it's asked for ("…and fix it", "can you add"), so "what does the build
// script do" stays an explain.
const EXPLAIN =
  /\b(explain|walk me through|help me understand|understand|get to know|what does .{1,60} do|how does .{1,60} work)\b/;
const ASKED_TASK = new RegExp(
  `(?:^|\\b(?:and|then|also|please)\\s+|\\b(?:can|could|would) you\\s+)${TASK_VERBS.source}`,
);
export const wantsExplain = (text: string) => {
  const t = text.trim().toLowerCase();
  return EXPLAIN.test(t) && !ASKED_TASK.test(t);
};

// brainstorm: thinking an idea or a choice through, before any code
const BRAINSTORM =
  /\b(brainstorm\w*|rough idea|bounce (some )?ideas?|think (this|it) through|explore (the )?(idea|options)|what are (my|our|the) options|pros and cons|sanity[- ]check (my|this|an?) (idea|plan|approach)|i have an? (idea|plan))\b/;
export const wantsBrainstorm = (text: string) => BRAINSTORM.test(text.toLowerCase());

const ask = (block: Block, reason: string): KernelOutput => ({ action: "ask", block, reason });
const silent = (intent: Intent, reason: string): KernelOutput => ({
  action: "continue",
  silence: { intent, reason },
});

// Fading on top of the pick: rung 1 turns the ask into a one-tap confirm, rung 2 into
// silence with its reason. Closing Return is never faded: every chat ends with it.
export function decideNextStep(input: KernelInput): KernelOutput {
  if (input.off) return { action: "continue" };
  const step = pickBlock(input);
  // a control chat keeps only the opening and closing Return
  const opensOrCloses =
    step.action === "ask" && (step.block.id === "X8" || step.block.id === "A10");
  if (input.control && !opensOrCloses) {
    return { action: "continue" };
  }
  const rung = input.lighter ? Math.max(input.rung ?? 0, 1) : input.rung;
  if (step.action !== "ask" || input.pause === "finish" || !rung) return step;
  if (step.block.intent === "orient") return step; // picking where to go never fades
  if (rung === 2)
    return silent(step.block.intent, "Shown on two days in two shapes; skarp stays quiet here.");
  return {
    ...step,
    block: {
      ...step.block,
      cost: "tap",
      answer_type: "choice",
      brief: `${step.block.brief} Make it a one-tap confirm with 2 short choices.`,
    },
    reason: `${step.reason} Lighter now: you've shown this before.`,
  };
}

function pickBlock(input: KernelInput): KernelOutput {
  const done = (i: Intent) => input.satisfiedIntents?.includes(i) ?? false;
  const kind = input.text === undefined ? "task" : classifyMessage(input.text);
  const text = input.text ?? "";

  switch (input.pause ?? "start") {
    case "start":
      // every chat opens with Return: what's due first
      if (input.due && !done("return"))
        return ask(BLOCKS.X8, "From an earlier chat here: due for recall.");
      // a quick question is answered first; the owed one waits for after it
      if (input.owedBefore && !done("return") && (kind === "task" || kind === "understand"))
        return ask(BLOCKS.X1, "You put this off in an earlier chat; it comes back small.");
      // understanding opens by picking where to start, before any task in it
      if (kind === "understand" && !done("orient")) {
        return ask(BLOCKS.O1, "New ground: pick a piece, and we go one at a time.");
      }
      if (done("commit")) return { action: "continue" };
      // chat gets silence; a quick question gets the answer first; only a task needs Commit
      if (kind !== "task" && !(kind === "understand" && hasTask(text))) {
        return silent("commit", kind);
      }
      if (TEST_SHORTCUT.test(text.toLowerCase()) && !done("challenge"))
        return ask(BLOCKS.R21, "Changing a test to pass can hide a bug in the code.");
      if (DESTRUCTIVE.test(text.toLowerCase()))
        return ask(BLOCKS["read-back"], "This can't be taken back: say what it destroys first.");
      if (BUG.test(text.toLowerCase()))
        return ask(BLOCKS.A14, "A bug: say where you think it is first.");
      if (input.deepOptIn) return ask(BLOCKS["LS-B7"], "You have time: one real try before help.");
      if (NAMES_CODE.test(text)) return ask(BLOCKS["LS-B1"], "Guess what the change will touch.");
      return ask(BLOCKS.A1, "Your own view first, before the AI shows its own.");

    case "after_turn": {
      // a check on the piece just explained; deeper only in "I have time"
      if (input.piece) {
        if (input.retry)
          return ask(BLOCKS.X4, `The same idea in a new shape, on "${input.piece}".`);
        return input.deepOptIn
          ? ask(BLOCKS.K8, `Fill the gap in "${input.piece}".`)
          : ask(BLOCKS.UC1, `One quick check on "${input.piece}".`);
      }
      const touched = input.touched ?? [];
      // a bug "fixed" by changing only tests may hide the bug; challenge it first
      const onlyTests = touched.length && touched.every((t) => TEST_FILE.test(t.path));
      if (onlyTests && kind === "task" && !done("challenge")) {
        return ask(BLOCKS.R21, "The change edits only tests; the bug may still be in the code.");
      }
      const risky = touched.some(
        (t) => t.removed?.some((l) => RISKY_OUT.test(l)) || t.added?.some((l) => RISKY_IN.test(l)),
      );
      if (risky && !done("challenge")) {
        return ask(
          BLOCKS.R21,
          "The change touches error handling or cleanup; it can break a promise the code makes.",
        );
      }
      if (touched.length && !done("explain")) {
        // Gap: aligned -> likely silence; diverged -> say it in your own words
        if (overlap(input.commitAnswer ?? "", touched) >= ALIGNED) {
          return silent("explain", "Your plan matched the change.");
        }
        return ask(BLOCKS["LS-B6"], "The change went somewhere your plan didn't.");
      }
      if (
        !touched.length &&
        kind === "question" &&
        input.grounded !== false &&
        HOW_IT_WORKS.test(text.toLowerCase()) &&
        !done("hear")
      ) {
        return ask(BLOCKS.K8, "Fill the gap in the walkthrough.");
      }
      if (input.owed) return ask(BLOCKS.X1, "A question you skipped, smaller.");
      return { action: "continue" };
    }

    case "before_run": {
      const command = input.command ?? "";
      if (READ_ONLY.test(command)) return silent("check", "It only reads; nothing to predict.");
      if (PREVIEW.test(command))
        return ask(BLOCKS["safe-preview"], "Predict, then the preview grades it.");
      if (TEST_RUN.test(command)) return ask(BLOCKS.R2, "Predict, then the run grades it.");
      return ask(BLOCKS.R8, "Give an input that breaks it; the run will tell.");
    }

    case "finish":
      // every chat closes with Return
      return ask(BLOCKS.A10, "What you keep from this chat.");
  }
}
