// skarp's modes beside a task: understand and brainstorm. Each has its own report, checked in code
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
    "Kept",
    "Not yet",
  ],
};

// --- Understanding a target (framework §18, D179-D185): the big picture, then one part at a
// time with a checked blank, then the next part; the cards move it, the AI writes each step ---

export const OVERVIEW_REPORT: ReportShape = {
  head: "## skarp: big picture",
  sections: ["What it is", "What it solves", "The main parts"],
};
export const PART_REPORT: ReportShape = {
  head: "## skarp: one part",
  sections: ["What it is", "Why it exists", "How it works", "Fill the gap"],
};
export const UNDERSTOOD_REPORT: ReportShape = {
  head: "## skarp: understood so far",
  sections: ["Covered", "Not yet"],
};
// O0's options (D179); O1 and O2 offer the parts the big picture named
export const BIG_PICTURE_HINTS = ["Proceed next", "Not understood"];
export const PART_HINTS = ["Not understood"]; // the K8 card: free text is the fill (D184)
export const DONE_FOR_NOW = "Done for now";
export const MAX_RETELLS = 3; // "Not understood" gets up to 3 new angles (D180)
export const understoodQuestion = (target: string) => `In one line: how does ${target} work?`;

// each "Not understood" tells it from a new angle; the third is the plainest form (D180)
const ANGLES = [
  "",
  "The user didn't follow it. Tell it again in simpler words, with one concrete example from this code.",
  "The user still didn't follow it. Tell it again with an everyday analogy, then map the analogy back to the code.",
  "The user still didn't follow it. Give the plainest form: each part in one short line, no terms left unexplained.",
];

// the parts the big picture named: "- **Name**: one line (path)" under The main parts
export function partLines(reply: string): { name: string; path?: string }[] {
  const at = reply.indexOf(`### ${OVERVIEW_REPORT.sections[2]}`);
  if (at < 0) return [];
  const body = reply.slice(at).split("\n").slice(1);
  const end = body.findIndex((l) => /^#{2,3} /.test(l));
  return (end < 0 ? body : body.slice(0, end))
    .flatMap((l) => {
      const name = l.match(/^\s*[-*]\s+\*\*(.+?)\*\*/)?.[1]?.trim();
      const path = l.match(/\(([^()]*[./][^()]*)\)\s*$/)?.[1]?.trim();
      return name ? [{ name, path }] : [];
    })
    .slice(0, 4);
}
export const partsIn = (reply: string) => partLines(reply).map((p) => p.name);

export function overviewRules(target: string, level: string, round = 0): string {
  return [
    `skarp understand: the user wants to understand ${target}. Read the code you need first; change no files.`,
    ANGLES[Math.min(round, MAX_RETELLS)] ?? "",
    `Write the big picture in a section headed exactly \`${OVERVIEW_REPORT.head}\`, with these sub-headings in this order: ${OVERVIEW_REPORT.sections.map((s) => `### ${s}`).join(", ")}.`,
    "What it is: one or two plain sentences, as if the user has never seen it. What it solves: the problem it exists for here.",
    "The main parts: 2-4 parts, one line each, written as `- **Part name**: what it does (path/to/file)`, then how they connect. Add a plain-text box-and-arrow diagram only if there is a flow worth drawing; mark unknown links with `?`.",
    "Do not go into any one part yet: the user picks where to start next.",
    DEPTH_FOR[level] ?? DEPTH_FOR.intermediate,
    "Never praise.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function partRules(part: string, level: string, round = 0): string {
  return [
    `skarp understand: explain only this part: ${part}. Change no files.`,
    ANGLES[Math.min(round, MAX_RETELLS)] ?? "",
    `Write it in a section headed exactly \`${PART_REPORT.head}\`, with these sub-headings in this order: ${PART_REPORT.sections.map((s) => `### ${s}`).join(", ")}.`,
    "What it is: one or two plain sentences. Why it exists: the problem it solves here. How it works: 3-6 steps, each citing file:line; a plain-text diagram only if there is a flow worth drawing.",
    "Explain each term where it first comes up.",
    K8_RULE,
    DEPTH_FOR[level] ?? DEPTH_FOR.intermediate,
    "Never praise.",
  ]
    .filter(Boolean)
    .join("\n");
}

// the ending (D185): what each part came to, then the A10 card
export function understoodRules(results: { part: string; result: string }[], left: string[]) {
  return [
    `skarp understand: end with a section headed exactly \`${UNDERSTOOD_REPORT.head}\`, with these sub-headings in this order: ${UNDERSTOOD_REPORT.sections.map((s) => `### ${s}`).join(", ")}.`,
    `Covered: one line per part, with what skarp recorded: ${results.map((r) => `${r.part}: ${r.result}`).join("; ") || "none"}.`,
    `Not yet: ${left.length ? `the parts not covered (${left.join(", ")}); skarp keeps them for later.` : 'write "Nothing left."'}`,
    "Change no files. Never praise.",
  ].join("\n");
}

// --- Hear before building (framework §4 K2: hear → reflect → apply; §7 Gap; §18 flows) ---
// On ground the user hasn't proven, the AI walks them through what the code does now and what
// will change, then leaves one K8 blank whose fill is checked against the line it cites.

export const HEAR_REPORT: ReportShape = {
  head: "## skarp: where you stand",
  sections: ["Your view", "What the code does now", "What will change", "The gap", "Fill the gap"],
};

// how deep the walkthrough goes: the level is the cold-start default until the area has history
const DEPTH_FOR: Record<string, string> = {
  beginner:
    "The user is a beginner: walk through the current code step by step and explain every term.",
  intermediate:
    "The user is intermediate: explain the key code and the parts their view missed in full, the rest briefly.",
  advanced:
    "The user is advanced: explain the current code and the change concisely, focusing on design choices and risks.",
};

// K8's blank: a statement with its conclusion blanked, then the line that shows the answer
const K8_RULE =
  'Fill the gap (K8): one statement, not a question, about the key step of what you explained, with its conclusion replaced by ___ at the end, followed by the file:line that shows the answer. Example: "applyDiscount subtracts ___ (src/cart.js:7)." Then stop and wait for the user\'s fill.';

export function hearRules(view: string | undefined, level: string, light: boolean): string {
  return [
    "skarp Hear: do not change any files yet; skarp refuses writes until the user has filled the gap. Read the code you need first.",
    `End your reply with a section headed exactly \`${HEAR_REPORT.head}\`, with these sub-headings in this order: ${HEAR_REPORT.sections.map((s) => `### ${s}`).join(", ")}.`,
    view
      ? `Your view: quote the user's answer to skarp's question exactly: "${view}".`
      : 'Your view: write "No view given."',
    "What the code does now: how the relevant code works today, step by step, citing file:line. What will change: the change you would make, which files, why, and what behaves differently afterwards.",
    "The gap: the user's view against the code: what matches, what's missing, what's off. Never say 'correct'; no praise.",
    K8_RULE,
    light
      ? "The user has shown this area before: keep the walkthrough short but complete."
      : (DEPTH_FOR[level] ?? DEPTH_FOR.intermediate),
  ].join("\n");
}

// a missed fill: explained another way and asked once more from a new angle; a second miss
// gets the plain answer (framework §18, understanding a target)
export function hearRetry(round: number, task: string): string {
  return round >= 2
    ? `The user missed the gap again. Give the plain answer now: what the code does and what will change, in simple words with one example from this code, citing file:line. Never say they were wrong. Then do the user's task: ${task}`
    : `Without judging the answer, explain that point another way: simpler words and a concrete example from this code. Then end with a new \`### Fill the gap\` from a new angle (${K8_RULE.replace(/^Fill the gap \(K8\): /, "")}) Do not change files.`;
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
  O0: BIG_PICTURE_HINTS,
  BS1: BS_HINTS,
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
