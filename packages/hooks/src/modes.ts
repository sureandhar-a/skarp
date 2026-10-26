// skarp's modes beside a task: explain and brainstorm. Each has its own report, checked in code
// like the task report; the rules are only what the AI is told, the checks are what counts.

export type Mode = "task" | "explain" | "brainstorm";

export interface ReportShape {
  head: string;
  sections: string[];
}

export const TASK_REPORT: ReportShape = {
  head: "## skarp: what changed",
  sections: [
    "Changes",
    "How it works",
    "New ideas",
    "Diagram",
    "Tests and checks",
    "Check by hand",
  ],
};

export const EXPLAIN_REPORT: ReportShape = {
  head: "## skarp: explained",
  sections: [
    "Big picture",
    "Diagram",
    "Key pieces",
    "How a request flows",
    "New ideas",
    "Where to start reading",
    "Your guess vs the code",
    "Your turn",
  ],
};

export const EXPLAIN_QUESTION =
  "Before the explanation: what do you think it does now, and which part matters most to you?";
// options come from code, never from the AI's own guesses: the user's view comes first
export const EXPLAIN_HINTS = ["I'll type my guess", "No idea yet"];
export const EXPLAIN_BACK = "In your own words: this works because ___";

export function explainRules(guess?: string): string {
  return [
    `skarp explain: read what you need, then end your reply with a section headed exactly \`${EXPLAIN_REPORT.head}\`, with these sub-headings in this order: ${EXPLAIN_REPORT.sections.map((s) => `### ${s}`).join(", ")}.`,
    "Big picture: what it is for, in a few lines. Diagram: plain-text box-and-arrow diagrams of the main parts and how data flows; mark unknown links with `?`. Key pieces: the files or modules that matter, one line each with its path. How a request flows: one real path through the code, step by step, with file names.",
    "New ideas: any concept or term the user may not know, explained. Where to start reading: 2-3 files in order, and why.",
    guess
      ? `Your guess vs the code: the user guessed "${guess}". Say plainly what matches the code and what doesn't, citing files.`
      : "Your guess vs the code: compare the user's answer to skarp's question with the code; if they gave none, write \"No guess given.\"",
    `Your turn: end with exactly this question for the user: "${EXPLAIN_BACK}"`,
    "Explain mode changes no files: skarp refuses writes. If the user wants a change, they say 'build it' and it becomes a task.",
    "Never praise.",
  ].join("\n");
}

// "build it" ends a no-change mode and starts the task it led to
export const BUILD_IT = /^(build it|let'?s build( it)?|go build|implement it|do it now)\b/i;
