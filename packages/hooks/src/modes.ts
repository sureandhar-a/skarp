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

// --- understand first: before the AI builds, you understand what exists and what will change ---

export const STAND_REPORT: ReportShape = {
  head: "## skarp: where you stand",
  sections: ["Your view", "What the code does now", "What will change", "The gap", "Quiz"],
};
export const PROCEED_QUESTION = "Ready for the AI to build it?";
export const PROCEED_HINTS = [
  "Yes, build it",
  "I didn't understand",
  "Still confused about a part",
];

// How long the explanation is: the user's level, and whether this area has faded. Every level
// gets the explanation before the quiz; a quiz alone doesn't build understanding.
const DEPTH_FOR: Record<string, string> = {
  beginner:
    "The user is a beginner: walk through the current code step by step and explain every term, then ask 2 quiz questions.",
  intermediate:
    "The user is intermediate: explain the key code and the parts their view missed in full, the rest briefly, then ask 1 quiz question.",
  advanced:
    "The user is advanced: explain the current code and the change concisely, focusing on design choices and risks, then ask 1 quiz question.",
};

export function understandRules(view: string | undefined, level: string, light: boolean): string {
  return [
    "skarp understand-first: do not change any files yet; skarp refuses writes until the user says to build. Read the code you need first.",
    "Explain first, then quiz: the user has to understand what exists now and what will change before you ask them anything. The explanation sections come before the quiz and are never skipped.",
    `Then end your reply with a section headed exactly \`${STAND_REPORT.head}\`, with these sub-headings in this order: ${STAND_REPORT.sections.map((s) => `### ${s}`).join(", ")}.`,
    view
      ? `Your view: quote the user's answer to skarp's question exactly: "${view}".`
      : 'Your view: write "No view given."',
    "What the code does now: explain how the relevant code works today, step by step, citing file:line. What will change: explain the change you would make, which files, why, and what behaves differently afterwards.",
    "The gap: compare the user's view with the code: what matches, what's missing, what's off. Never say 'correct'; no praise. If their view already matches, say so in one line.",
    "Quiz: only after the explanation. Questions the user answers in their own words, about what you just explained: what the code does now and what will change. Not yes/no, and not answerable by copying your text. Then stop and wait for their answer.",
    light
      ? "The user has shown they know this area: keep the explanation short but complete (what exists, what changes), then 1 quiz question."
      : (DEPTH_FOR[level] ?? DEPTH_FOR.intermediate),
  ].join("\n");
}

// "build it" ends a no-change mode and starts the task it led to
export const BUILD_IT = /^(build it|let'?s build( it)?|go build|implement it|do it now)\b/i;

// --- brainstorm: a senior colleague who asks, stress-tests and records, never a yes-man ---

export type Phase = "you-first" | "listing" | "stress" | "decide";

export interface MapEvent {
  type: "idea" | "arg" | "verdict" | "question" | "open";
  idea?: string;
  by?: "you" | "ai";
  side?: "for" | "against";
  verdict?: string;
  category?: string;
  text: string;
  evidence?: string;
}

export const BS_QUESTION =
  "Before any ideas from the AI: what's your idea or first guess? (Or say 'your ideas first'.)";
export const BS_HINTS = ["I'll type my idea", "Your ideas first"];
export const BS_DECIDE = "Which option do you pick, and why, in your own words?";
// the questions a senior asks in a design review (Rust RFC template, review practice)
export const CATEGORIES = [
  "do-nothing",
  "alternatives",
  "why-not",
  "prior-art",
  "failure",
  "rollback",
  "operations",
  "unresolved",
];
export const UNLOCK = /\b(your ideas?( first)?|you (go|start) first|you first|no idea)\b/i;
export const DONE_LISTING =
  /^(done|that'?s (all|it)|no more|nothing else|that'?s everything|now (challenge|critique|stress[- ]test)( it| them)?|go ahead)\b/i;
export const DECIDE =
  /\b(decide|decision|let'?s go with|i('ll| will)? go with|i pick|i choose|we('ll| will) go with)\b/i;
export const RESUME = /\b(continue|resume|back to|pick up) (the |our |my )?brainstorm/i;
// work that can't easily be taken back: a pre-mortem before deciding (research idea 7)
const STAKES =
  /\b(schema|migrat\w*|auth\w*|login|password|secur\w*|payment|billing|money|public api|delete|drop|irreversible|production data)\b/i;
export const highStakes = (text: string) => STAKES.test(text);
// "great idea" with nothing behind it (research idea 10)
const AGREE =
  /^\W*(great|good|nice|excellent|love|you'?re (right|correct)|that works|that('ll| will) work|makes sense|absolutely|exactly|agreed)\b/i;
const EVIDENCE =
  /[\w-]+\.[a-z]{1,4}(:\d+)?|`[^`]+`|\bhttps?:\/\/|\d|\brisk\b|\bfails?\b|\bbreaks?\b/i;

const PHASE_RULE: Record<Phase, string> = {
  "you-first":
    "Phase: you first. Do not suggest ideas, options or approaches. Ask skarp's question and wait for the user's own idea.",
  listing:
    'Phase: listing. The user is listing their ideas. Only acknowledge each in one line (record it in the map as `(you)`), then ask "Anything else? Say done when you have listed them." No critique, no verdicts, no ideas of your own yet.',
  stress:
    "Phase: stress test. Ask one question at a time and judge ideas with evidence. You may add at most one direction the user didn't consider, labelled `(ai)` in the map.",
  decide: `Phase: decide. Ask the user exactly: "${BS_DECIDE}" Do not decide for them.`,
};

export function brainstormRules(phase: Phase, stakes: boolean): string {
  return [
    "skarp brainstorm: you are a senior colleague stress-testing the user's own ideas. You are not an idea generator and not a yes-man.",
    PHASE_RULE[phase],
    "Ask, don't tell: challenge through questions. Give your own view only after the user has answered, labelled `My view:`, and never hold back a flaw that would sink the idea.",
    'Before you judge an idea, restate it neutrally in the third person as a question, on a line starting `Restated:` (e.g. `Restated: Would moving the queue to Redis remove the lock waits?`), dropping "I\'m sure" or "obviously".',
    `Put your questions under \`### Question\`: at most 2, each quoting the user's exact words in double quotes. Pick from: ${CATEGORIES.join(", ")}.`,
    "Every verdict needs evidence: a file:line you read, a source, a number, or a test that would show it. If you don't know, the verdict is `unknown` with how to find out.",
    'Never praise and never agree without evidence: no "great idea" or "you\'re right" unless the same reply shows why.',
    stakes && phase === "decide"
      ? 'This touches work that is hard to undo: before asking which option, write `### Pre-mortem`: "It\'s 3 months later and this was reverted. Most likely reason, and is it in our control?"'
      : "",
    "End every reply with a `### skarp map` block of what changed this turn, one line each:\n- idea I1 (you): <text>   (or (ai) for yours)\n- for I1: <text> [evidence: <file:line or source>]\n- against I1: <text> [evidence: ...]\n- verdict I1: holds | risky | doesn't hold | unknown, <why> [evidence: ...]\n- question <category>: \"<the user's words you quote>\"\n- open: <open question>",
    "Brainstorm changes no files: skarp refuses writes. When the user wants it built, they say 'build it'.",
  ]
    .filter(Boolean)
    .join("\n");
}

// The `### skarp map` block: what changed in the brainstorm this turn.
export function parseMap(reply: string): MapEvent[] {
  const at = reply.indexOf("### skarp map");
  if (at < 0) return [];
  const block = reply.slice(at + 13).split(/\n#{2,3} /)[0] ?? "";
  const out: MapEvent[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.replace(/^\s*[-*]\s*/, "").trim();
    const ev = line.match(/\[evidence:\s*([^\]]+)\]/i)?.[1]?.trim();
    const text = (s: string) => s.replace(/\[evidence:[^\]]*\]/i, "").trim();
    let m = line.match(/^idea\s+(\w+)\s*\((you|ai)\)\s*:\s*(.+)$/i);
    if (m) {
      out.push({
        type: "idea",
        idea: m[1],
        by: m[2]?.toLowerCase() as "you" | "ai",
        text: text(m[3] ?? ""),
      });
      continue;
    }
    m = line.match(/^(for|against)\s+(\w+)\s*:\s*(.+)$/i);
    if (m) {
      const side = m[1]?.toLowerCase() as "for" | "against";
      out.push({ type: "arg", side, idea: m[2], text: text(m[3] ?? ""), evidence: ev });
      continue;
    }
    m = line.match(/^verdict\s+(\w+)\s*:\s*(holds|risky|doesn'?t hold|unknown)\b[,\s]*(.*)$/i);
    if (m) {
      const verdict = (m[2] ?? "").toLowerCase().replace("doesnt", "doesn't");
      out.push({ type: "verdict", idea: m[1], verdict, text: text(m[3] ?? ""), evidence: ev });
      continue;
    }
    m = line.match(/^question\s+([\w-]+)\s*:\s*(.+)$/i);
    if (m) {
      out.push({ type: "question", category: m[1]?.toLowerCase(), text: text(m[2] ?? "") });
      continue;
    }
    m = line.match(/^open\s*:\s*(.+)$/i);
    if (m) out.push({ type: "open", text: text(m[1] ?? "") });
  }
  return out;
}

// What a brainstorm reply breaks, for its phase. Shape and wording only: checked in code, so the
// rules hold even when the model drifts from them.
export function brainstormFixes(
  reply: string,
  phase: Phase,
  said: string[],
  stakes: boolean,
  unlocked: boolean,
): string[] {
  const map = parseMap(reply);
  const fixes: string[] = [];
  const numbered = (reply.match(/^\s*(?:\d+[.)]|[-*]\s+\*\*Option)/gim) ?? []).length;
  if (phase === "you-first" && !unlocked && (map.some((e) => e.by === "ai") || numbered >= 2))
    fixes.push(
      "The user hasn't given their own idea yet: remove your ideas and options, and ask skarp's question.",
    );
  if (phase === "listing" && map.some((e) => e.type === "verdict" || e.side === "against"))
    fixes.push(
      'The user is still listing ideas: no critique or verdicts yet. Acknowledge and ask "Anything else? Say done when you have listed them."',
    );
  if (phase === "stress") {
    if (map.some((e) => e.type === "verdict") && !/^\s*Restated:/m.test(reply))
      fixes.push("Before judging, restate the idea neutrally as a question on a `Restated:` line.");
    const q = reply.match(/### Question\n([\s\S]*?)(?=\n#{2,3} |$)/)?.[1];
    if (q === undefined)
      fixes.push("Ask one question under `### Question`, quoting the user's words.");
    else {
      if ((q.match(/\?/g) ?? []).length > 2)
        fixes.push("Ask at most 2 questions under `### Question`.");
      const lower = said.join("\n").toLowerCase().replace(/\s+/g, " ");
      const quotes = [...q.matchAll(/["“]([^"”]{3,})["”]/g)].map((m) =>
        (m[1] ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
      );
      if (!quotes.length || !quotes.every((x) => lower.includes(x)))
        fixes.push("Each question must quote the user's exact words in double quotes.");
    }
  }
  if (phase === "decide" && stakes && !reply.includes("### Pre-mortem"))
    fixes.push(
      'This is hard to undo: add `### Pre-mortem`: "It\'s 3 months later and this was reverted. Most likely reason, and is it in our control?"',
    );
  if (AGREE.test(reply) && !EVIDENCE.test(reply.slice(0, 400)))
    fixes.push(
      "You agree without evidence: back it with a file, number or source, or state the risk.",
    );
  if (!map.length && phase !== "decide") fixes.push("End with the `### skarp map` block.");
  return fixes;
}

export interface BsIdea {
  id: string;
  by: "you" | "ai";
  text: string;
}

// The record a closed brainstorm leaves: generated from its log, never written by the AI.
export function brainstormSummary(
  topic: string,
  events: (MapEvent & { kind?: string; chosen?: string; why?: string; role?: string })[],
): { md: string; coverage: number; byYou: number; byAi: number } {
  const ideas = events.filter((e) => e.type === "idea");
  const asked = new Set(events.filter((e) => e.type === "question").map((e) => e.category));
  const coverage = CATEGORIES.filter((c) => asked.has(c)).length;
  const decision = events.find((e) => e.kind === "decision");
  const turns = events.filter((e) => e.kind === "turn").length;
  const line = (e: MapEvent) => `${e.text}${e.evidence ? ` [${e.evidence}]` : ""}`;
  const md = [
    `# Brainstorm: ${topic}`,
    "",
    "## Outcome",
    decision ? `- **Decision:** ${decision.chosen}` : "- No decision yet.",
    decision?.why ? `- **Why (your words):** ${decision.why}` : "",
    ...events.filter((e) => e.type === "open").map((e) => `- Open: ${e.text}`),
    "",
    "## Ideas",
    ...ideas.flatMap((i) => [
      `- **${i.idea}** (${i.by === "you" ? "you" : "AI"}): ${i.text}`,
      ...events
        .filter((e) => e.idea === i.idea && e.type !== "idea")
        .map((e) => `  - ${e.type === "verdict" ? `verdict: ${e.verdict}` : e.side}: ${line(e)}`),
    ]),
    "",
    "## Process",
    `- ${turns} turns; senior questions covered ${coverage} of ${CATEGORIES.length} (${[...asked].filter(Boolean).join(", ") || "none"})`,
    "- Full log: log.jsonl",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return {
    md: `${md}\n`,
    coverage,
    byYou: ideas.filter((i) => i.by === "you").length,
    byAi: ideas.filter((i) => i.by === "ai").length,
  };
}

// --- the first question's options: neutral hints from code, never the AI's guesses ---

const HINTS: Record<string, string[]> = {
  A14: ["UI", "Data or API", "Config or environment"], // where is the bug
  "LS-B1": ["One file", "A few related files", "Across the app"], // which part will it touch
  A1: ["I have a plan", "A rough idea", "Not sure yet"], // your plan
  "LS-B7": ["I'll write it", "Not sure yet"], // try it once yourself
  R21: ["The test is wrong", "The code is wrong", "Not sure yet"], // test-only change
  "read-back": ["I'll type it", "Not sure yet"], // what does this destroy
  EX1: EXPLAIN_HINTS,
  BS1: BS_HINTS,
  GO: PROCEED_HINTS,
};
export const hintsFor = (block: string) => HINTS[block] ?? ["I'll type my answer", "Not sure yet"];

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Whether a question card asks skarp's question with skarp's options. Claude: { questions: [{
// question, options: [{ label }] }] }; VS Code's shape may differ, so an unreadable card passes.
export function cardFixes(input: unknown, question: string, hints: string[]): string[] {
  const ask = input as
    | { message?: string; requestedSchema?: { properties?: Record<string, unknown> } }
    | undefined;
  if (typeof ask?.message === "string") return askUserFixes(ask, question, hints);
  const q = (input as { questions?: unknown[] } | undefined)?.questions?.[0] as
    | { question?: string; options?: ({ label?: string } | string)[] }
    | undefined;
  if (!q || (typeof q.question !== "string" && !Array.isArray(q.options))) return [];
  const fixes: string[] = [];
  if (typeof q.question === "string" && !norm(q.question).includes(norm(question)))
    fixes.push(`Ask skarp's question word for word: "${question}"`);
  const labels = (q.options ?? []).map((o) => (typeof o === "string" ? o : (o.label ?? "")));
  if (labels.length && !optionsOk(labels, hints))
    fixes.push(`Use exactly these options: ${[...hints, "Skip"].map((h) => `"${h}"`).join(", ")}.`);
  return fixes;
}

// Copilot's ask_user: { message, requestedSchema: { properties: { field: { enum?, default? } } } }.
// A pre-filled default is the AI's own guess, shown as if it were the user's answer.
function askUserFixes(
  ask: { message?: string; requestedSchema?: { properties?: Record<string, unknown> } },
  question: string,
  hints: string[],
): string[] {
  const fixes: string[] = [];
  if (!norm(ask.message ?? "").includes(norm(question)))
    fixes.push(`Ask skarp's question word for word: "${question}"`);
  const fields = Object.values(ask.requestedSchema?.properties ?? {}) as {
    enum?: string[];
    default?: unknown;
  }[];
  if (fields.some((f) => f.default !== undefined))
    fixes.push("Leave out the default answer: the user gives their own.");
  const labels = fields.flatMap((f) => f.enum ?? []);
  if (labels.length && !optionsOk(labels, hints))
    fixes.push(`Use exactly these options: ${[...hints, "Skip"].map((h) => `"${h}"`).join(", ")}.`);
  return fixes;
}

export const optionsOk = (labels: string[], hints: string[]) => {
  const allowed = new Set([...hints, "Skip"].map(norm));
  return labels.every((l) => allowed.has(norm(l)));
};
