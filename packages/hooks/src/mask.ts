// The shareable report (framework §11): a masked copy of the diagnostic log and your flags. Only
// common words stay readable; the private log is never changed, and nothing here sends anything.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logDays, logDir, logOn, telemetryFile, usefulTelemetry } from "./diag.ts";
import { COMMON_WORDS } from "./words.gen.ts";

// skarp's own vocabulary and everyday coding words, so its rules can still be judged from a report
const SKARP_WORDS =
  "skarp copilot claude vscode hook hooks card cards ledger brainstorm walkthrough overview codebase repo repository refactor debug config commit commits branch merge diff bug bugs fix fixes fixed test tests api ui deploy tool tools agent agents model models prompt prompts blank blanks flag flags session sessions module modules function functions file files folder folders explain explains explanation understand understands implement implementation install setup transcript report reports stdin stdout json yaml markdown md a i ai vs askuserquestion askquestions ask_user toolsearch hypothesis beginner intermediate skip skipped refuses refused labelled numbered masked pre-filled sub-headings headings mermaid diagram bullet walkthroughs unresolved uncertain deny";
const KEEP = new Set(`${COMMON_WORDS} ${SKARP_WORDS}`.split(" "));

export const alwaysMaskFile = (home: string) => join(home, "always-mask.txt");
const lookupFile = (home: string) => join(home, "mask-lookup.json");
export const reportFile = (home: string) => join(home, "shared", "skarp-report.md");

export const readAlwaysMask = (home: string): string[] => {
  try {
    return readFileSync(alwaysMaskFile(home), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Kind = "name" | "path" | "num" | "id";

// One masking pass. Placeholders stay the same across reports; what they stand for stays on this
// machine in mask-lookup.json.
export function masker(home: string) {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(readFileSync(lookupFile(home), "utf8"));
  } catch {}
  const counts: Record<Kind, number> = { name: 0, path: 0, num: 0, id: 0 };
  for (const v of Object.values(map)) {
    const m = /^(name|path|num|id)-(\d+)$/.exec(v);
    if (m) counts[m[1] as Kind] = Math.max(counts[m[1] as Kind], Number(m[2]));
  }
  const hidden: Record<Kind, number> = { name: 0, path: 0, num: 0, id: 0 };
  const ph = (kind: Kind, value: string) => {
    hidden[kind]++;
    const key = `${kind}:${value.toLowerCase()}`;
    map[key] ??= `${kind}-${++counts[kind]}`;
    return map[key];
  };
  const always = readAlwaysMask(home);
  const alwaysRe = always.length
    ? new RegExp(
        `(?<![\\w-])(?:${[...always]
          .sort((a, b) => b.length - a.length)
          .map(esc)
          .join("|")})(?![\\w-])`,
        "gi",
      )
    : undefined;
  const second = new Set<string>(); // kept words written like names: worth a second look

  const word = (tok: string): string => {
    const core = tok.replace(/^[.'’-]+|[.'’-]+$/g, "");
    if (!core || /^(name|path|num|id)-\d+$/.test(core)) return tok;
    if (!/[a-z]/i.test(core)) return /\d/.test(core) ? tok.replace(core, ph("num", core)) : tok;
    const base = core.toLowerCase().replace(/['’](s|t|re|ve|ll|d|m)$/, "");
    return base.split("-").every((w) => KEEP.has(w)) ? tok : tok.replace(core, ph("name", core));
  };
  const text = (s: string): string => {
    let t = s
      .replace(/```[\s\S]*?```/g, (b) => `[code: ${Math.max(b.split("\n").length - 2, 0)} lines]`)
      .replace(/\bhttps?:\/\/\S+/g, (m) => ph("path", m))
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => ph("name", m))
      .replace(/(?:[A-Za-z]:\\|~[\\/]|\.{0,2}[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]*/g, (m) =>
        ph("path", m),
      );
    if (alwaysRe) t = t.replace(alwaysRe, (m) => ph("name", m));
    for (const m of t.matchAll(/(?<=[a-z,;:] )[A-Z][a-z]+\b/g))
      if (KEEP.has(m[0].toLowerCase())) second.add(m[0]);
    return t.replace(/\[code: \d+ lines\]|[^\s`*_#|()[\]{}<>:;,!?"=/\\]+/g, (tok) =>
      tok.startsWith("[code:") ? tok : word(tok),
    );
  };
  // Written by skarp or the agent's own field names: can't hold your words
  const SAFE = new Set(
    "v time event surface skarp os node source transcript block step result kind check tool model hook via intent phase not_run classify fields keys name gen_ai.operation.name gen_ai.request.model gen_ai.response.model gen_ai.tool.name gen_ai.tool.type copilot_chat.hook_type copilot_chat.hook_result_kind github.copilot.hook.decision error.type mode hear asking hookEventName permissionDecision decision und_step bs_phase".split(
      " ",
    ),
  );
  const IDS = new Set(
    "session session_id task task_id tool_use_id gen_ai.conversation.id gen_ai.tool.call.id copilot_chat.session_id copilot_chat.chat_session_id".split(
      " ",
    ),
  );
  const PATHS = new Set(
    "cwd path file_path filePath notebook_path transcript_path copilot_chat.hook_command".split(
      " ",
    ),
  );
  const field = (key: string, v: unknown): unknown => {
    if (typeof v === "string") {
      if (SAFE.has(key)) return v;
      if (IDS.has(key)) return ph("id", v);
      if (PATHS.has(key)) return ph("path", v);
      return text(v);
    }
    if (Array.isArray(v)) return v.map((x) => field(key, x));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          /^[A-Za-z_][\w.-]*$/.test(k) ? k : text(k),
          field(k, x),
        ]),
      );
    return v;
  };
  return {
    text,
    field,
    hidden,
    second,
    save() {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(lookupFile(home), JSON.stringify(map), { mode: 0o600 });
    },
    lookup: (placeholder: string) =>
      Object.entries(map)
        .find(([, v]) => v === placeholder)?.[0]
        .replace(/^\w+:/, ""),
  };
}

type Line = Record<string, unknown> & { event?: string; session?: string; time?: string };

function readLog(home: string): Line[] {
  const lines: Line[] = [];
  for (const f of logDays(home)) {
    try {
      for (const l of readFileSync(join(logDir(home), f), "utf8").split("\n"))
        if (l) lines.push(JSON.parse(l));
    } catch {}
  }
  // telemetry not yet moved into the log, read without emptying the file
  try {
    lines.push(...(usefulTelemetry(readFileSync(telemetryFile(home), "utf8")) as Line[]));
  } catch {}
  return lines;
}

export interface ReportOptions {
  session?: string;
  since?: string; // an ISO date
  all?: boolean;
}

export interface ReportResult {
  path: string;
  lines: number;
  flags: number;
  hidden: Record<string, number>;
  second: string[];
  alwaysMask: number;
  logOn: boolean;
}

export const lastSession = (home: string): string | undefined =>
  readLog(home)
    .filter((l) => l.event !== "telemetry")
    .findLast((l) => l.session)?.session;

// By default the last session and every session with a flag; a report on all of them on request.
export function writeReport(home: string, o: ReportOptions = {}): ReportResult {
  const log = readLog(home);
  const flagged = new Set(log.filter((l) => l.event === "flag").map((l) => l.session));
  const last = lastSession(home);
  const picked = log
    .filter((l) => {
      if (o.since && (l.time ?? "") < o.since) return false;
      if (o.session) return l.session === o.session;
      if (o.all || o.since) return true;
      return l.session === last || flagged.has(l.session);
    })
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  const m = masker(home);
  const sessions = new Map<string, Line[]>();
  for (const l of picked) {
    const k = l.session ?? "none";
    sessions.set(k, [...(sessions.get(k) ?? []), l]);
  }
  const summary = [...sessions.entries()].map(([id, ls]) => {
    const first = ls.find((l) => l.event === "session");
    const count = (e: string) => ls.filter((l) => l.event === e).length;
    const models = new Set(
      ls.flatMap((l) => [
        (l.attrs as Record<string, unknown> | undefined)?.["gen_ai.response.model"],
        l.model,
        (l.reply as { model?: unknown } | undefined)?.model,
      ]),
    );
    models.delete(undefined);
    const sent = ls.filter(
      (l) => (l.output as { decision?: string } | undefined)?.decision === "block",
    );
    return `- \`${m.field("session", id)}\`: ${first?.surface ?? "unknown agent"}, skarp ${first?.skarp ?? "unknown"}, ${first?.os ?? ""} node ${first?.node ?? ""}; models: ${[...models].join(", ") || "not known"}; ${ls.length} lines, ${count("flag")} flags, ${count("card_refused")} cards refused, ${sent.length} sent back or blocked, ${count("hook_crash")} crashes`;
  });
  const flags = picked.filter((l) => l.event === "flag");
  const flagLines = flags.map(
    (l) =>
      `- ${l.time} in \`${m.field("session", l.session ?? "none")}\`: ${m.text(String(l.text ?? ""))}`,
  );
  const masked = picked.map((l) => JSON.stringify(m.field("", l)));
  const alwaysMask = readAlwaysMask(home).length;
  const on = logOn(home);
  const warn = [
    "> **Read this file before you share it.** Names, paths and code are replaced, but masking can miss things, and ordinary words can still show what you work on. Screenshots are never masked: check them yourself.",
    alwaysMask
      ? ""
      : "\n> **Your always-mask list is empty**, so a company or product name that is also an ordinary word (like Apple) stays visible. Run `npx skarp-copilot report` to add names.",
    on
      ? ""
      : "\n> **Logging is off**, so this report only has what was recorded before it was turned off.",
  ].join("");
  const body = [
    "# skarp report",
    warn,
    "## Sessions",
    summary.join("\n") || "Nothing recorded.",
    "## Your flags",
    flagLines.join("\n") || "None.",
    "## Log (masked)",
    `\`\`\`jsonl\n${masked.join("\n")}\n\`\`\``,
    "",
  ].join("\n\n");
  const path = reportFile(home);
  mkdirSync(join(home, "shared"), { recursive: true, mode: 0o700 });
  writeFileSync(path, body, { mode: 0o600 });
  m.save();
  return {
    path,
    lines: picked.length,
    flags: flags.length,
    hidden: m.hidden,
    second: [...m.second].sort(),
    alwaysMask,
    logOn: on,
  };
}

export const reportExists = (home: string) => existsSync(reportFile(home));
