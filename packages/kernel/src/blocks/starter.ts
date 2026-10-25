import type { Block } from "./base.ts";

// Release 1 starter blocks, from the framework catalogue.
// Doubt mark is not here: you start it with a key on a line, skarp never asks it.
// Silence is not here: it is the kernel choosing not to ask.
const list = [
  {
    id: "A1",
    intent: "commit",
    cost: "tap",
    answer_type: "text",
    brief: "Invite any half-thought about how to approach the task; any answer counts.",
    question_text: "What is your hypothesis or plan before we ask the model?",
  },
  {
    id: "LS-B1",
    intent: "commit",
    cost: "tap",
    answer_type: "choice",
    brief:
      "Write 3 plausible guesses about which files or parts the change will touch. Name parts of the code; don't assume the user's description of the code is true.",
    question_text: "Which part of the code do you expect this change to touch?",
  },
  {
    id: "A14",
    intent: "commit",
    cost: "short",
    answer_type: "text",
    brief: "Ask where the user thinks the bug is, before the AI looks.",
    question_text: "Where do you think the bug is?",
  },
  {
    id: "LS-B7",
    intent: "commit",
    cost: "deep",
    answer_type: "text",
    brief: "Ask for one real attempt at the piece before any help.",
    question_text: "Try it once yourself first. What would you write?",
    opt_in: true,
  },
  // Understand: pick a piece, hear it, a check, the next piece. Orient is a choice,
  // never graded; the pieces and "Next piece?" choices come from core, not the model.
  {
    id: "O1",
    intent: "orient",
    cost: "tap",
    answer_type: "choice",
    brief: "Ask which piece to start with.",
    question_text: "Where do we start?",
  },
  {
    id: "O2",
    intent: "orient",
    cost: "tap",
    answer_type: "choice",
    brief: "Ask which piece comes next.",
    question_text: "Next piece?",
  },
  {
    id: "UC1",
    intent: "hear",
    cost: "tap",
    answer_type: "choice",
    // applying the idea to a case not shown, never what the paragraph above says word for
    // word; only with names the explanation showed
    brief:
      "One question that applies the key idea of the piece to a case the explanation did not show (another input, or what happens if one line changed), using only functions and values the explanation named. 3 options; exactly one is right, worked out from the code. Never ask something the explanation states outright.",
    question_text: "Fill the blank: this piece works because ___.",
    graded: true,
    sure: true,
  },
  {
    id: "K8",
    intent: "hear",
    cost: "short",
    answer_type: "text",
    // a statement with its conclusion blanked, never a question with a blank in it
    brief:
      'One statement (not a question) about the key step, with its conclusion replaced by ___ at the end, for the user to fill in. Example: "commit() lowers the stock after ___."',
    question_text: "Fill the blank: this works because ___.",
    sure: true,
  },
  {
    id: "X6",
    intent: "fly",
    cost: "tap",
    answer_type: "choice",
    brief: "One tiny prediction about the result while the AI works, with 2-3 options.",
    question_text: "What do you expect the AI's change to do?",
  },
  {
    id: "LS-B6",
    intent: "explain",
    cost: "short",
    answer_type: "text",
    brief: 'Quote one line the AI wrote and ask the user to finish "This works because ___".',
    question_text: "This works because ___",
    sure: true,
    evidence: true,
  },
  // Challenge: the strongest case against a change, before you accept it
  {
    id: "R21",
    intent: "challenge",
    cost: "tap",
    answer_type: "choice",
    brief:
      "In one line, state the strongest case against the plan or the AI's change, naming the real risk from the context (a test edit can hide a bug in the code; a change to error handling or cleanup can leave things half done), then ask what to do, with 2 choices: go ahead as it is, or the safer way.",
    question_text: "This change edits only a test. Is the test wrong, or the code?",
  },
  // Read-back: for destructive work, the blast radius and the rollback first
  {
    id: "read-back",
    intent: "check",
    cost: "short",
    answer_type: "text",
    brief:
      "Ask what this would destroy or change for good, and how the user would undo it if it goes wrong.",
    question_text: "Before anything runs: what does this destroy, and how would you undo it?",
  },
  {
    id: "R2",
    intent: "check",
    cost: "tap",
    answer_type: "choice",
    // the options together cover every outcome, so the true one is always there
    brief:
      "Before running it, ask what the run or test will show, with 3 options that between them cover every outcome: all pass, some fail (say which), or it errors before running.",
    question_text: "What will the run show?",
    sure: true,
  },
  {
    id: "R8",
    intent: "check",
    cost: "short",
    answer_type: "text",
    brief: "Ask for one input where this code would fail.",
    question_text: "Give one input where this breaks.",
  },
  {
    id: "safe-preview",
    intent: "check",
    cost: "tap",
    answer_type: "choice",
    brief:
      "Before a dry-run, EXPLAIN, plan or count, ask what the preview will show, with 2-3 options.",
    question_text: "What will the preview show?",
  },
  // Same idea, new shape: the retry after a missed check, as steps to put in order
  {
    id: "X4",
    intent: "return",
    cost: "short",
    answer_type: "order",
    brief:
      "The same idea as the check just missed, in a new shape: 3 or 4 short steps of what the code does, which the user puts in order.",
    question_text: "Put these steps in the order the code runs them.",
    graded: true,
    sure: true,
  },
  {
    id: "X8",
    intent: "return",
    cost: "short",
    answer_type: "text",
    brief: "A short recall question on a concept that is due, in a new form.",
    question_text: "From last time: how does this part work?",
    sure: true,
    evidence: true,
  },
  {
    id: "A4",
    intent: "return",
    cost: "short",
    answer_type: "text",
    brief: "Reopen a closed chat with one new fact and ask how the user would solve it now.",
    question_text: "One thing changed since that chat. How would you solve it now?",
  },
  {
    id: "A10",
    intent: "return",
    cost: "tap",
    answer_type: "text",
    brief: "Ask what carries over from this chat, and what is still not yet.",
    question_text: "What do you take from this chat, and what's not yet?",
  },
  {
    id: "X1",
    intent: "return",
    cost: "tap",
    answer_type: "text",
    brief: "Bring back a skipped question, smaller.",
    question_text: "Earlier you skipped a question. Want to answer it now?",
  },
] as const satisfies readonly Block[];

export type BlockId = (typeof list)[number]["id"];
export const BLOCKS = Object.fromEntries(list.map((b) => [b.id, b])) as Record<BlockId, Block>;
