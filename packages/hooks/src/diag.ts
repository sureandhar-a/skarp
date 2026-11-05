// The diagnostic log (framework §11): how skarp itself behaved, kept apart from the ledger. Nothing
// in skarp reads it to decide anything, and a failure here never reaches the agent (rule 17).
// One line per event, one file per day, in ~/.skarp/log.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const LOG_VERSION = 1;
const KEEP_DAYS = 14;
const FLAG_KEEP_DAYS = 30;
const MAX_TOTAL = 50 * 1024 * 1024;
const MAX_TEXT = 32 * 1024;
const MAX_TELEMETRY = 200 * 1024 * 1024; // a file this big is mostly metrics: not worth reading
const DAY = 24 * 60 * 60 * 1000;

export const logDir = (home: string) => join(home, "log");
export const telemetryFile = (home: string) => join(home, "telemetry", "copilot.jsonl");
const dayFile = (home: string, day: string) => join(logDir(home), `${day}.jsonl`);
const lostFile = (home: string) => join(logDir(home), "lost");

// Things shaped like keys and tokens never reach the disk. A few fast patterns: the rest of the
// masking happens when sharing, on a copy.
const SECRETS =
  /\b(?:sk-[\w-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{16,}|xox[a-z]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|AIza[\w-]{30,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,})\b|(Bearer\s+)[\w.~+/-]{12,}=*|((?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;"']+/gi;

export const scrub = (text: string) =>
  text.replace(SECRETS, (_m, bearer = "", named = "") => `${bearer}${named}[secret]`);

// every string: scrubbed, and cut with its original length noted
function clean(v: unknown): unknown {
  if (typeof v === "string") {
    const t = scrub(v);
    return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…[cut, ${t.length} chars]` : t;
  }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
}

export function logOn(home: string): boolean {
  if (process.env.SKARP_LOG === "off") return false;
  try {
    return JSON.parse(readFileSync(join(home, "config.json"), "utf8")).log !== false;
  } catch {
    return true;
  }
}

// One event. Best effort and sync, so lines land in order; a lost line is counted on the next write.
export function diag(home: string, event: string, fields: object) {
  if (!logOn(home)) return;
  const now = new Date();
  try {
    const day = now.toISOString().slice(0, 10);
    const file = dayFile(home, day);
    if (!existsSync(file)) {
      mkdirSync(logDir(home), { recursive: true, mode: 0o700 });
      newDay(home, day, now.getTime());
    }
    let line = `${JSON.stringify(clean({ v: LOG_VERSION, time: now.toISOString(), event, ...fields }))}\n`;
    if (existsSync(lostFile(home))) {
      const lost = statSync(lostFile(home)).size;
      rmSync(lostFile(home));
      line = `${JSON.stringify({ v: LOG_VERSION, time: now.toISOString(), event: "lost_lines", count: lost })}\n${line}`;
    }
    appendFileSync(file, line, { mode: 0o600 });
  } catch {
    try {
      appendFileSync(lostFile(home), "x");
    } catch {}
  }
}

// First write of a day: old days go, the telemetry file shrinks to what matters. Each step on its
// own, since a failed clean-up must still leave today's line.
function newDay(home: string, today: string, now: number) {
  try {
    moveTelemetry(home, today);
  } catch {}
  try {
    trimDays(home, today, now);
  } catch {}
}

export function logDays(home: string): string[] {
  try {
    return readdirSync(logDir(home))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

function trimDays(home: string, today: string, now: number) {
  const dir = logDir(home);
  const age = (f: string) => (now - Date.parse(f.slice(0, 10))) / DAY;
  const flagged = (f: string) => readFileSync(join(dir, f), "utf8").includes('"event":"flag"');
  const kept: string[] = [];
  for (const f of logDays(home)) {
    if (f.startsWith(today)) continue;
    const a = age(f);
    if (a > FLAG_KEEP_DAYS || (a > KEEP_DAYS && !flagged(f))) rmSync(join(dir, f));
    else kept.push(f);
  }
  let total = kept.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  for (const f of kept) {
    if (total <= MAX_TOTAL) break;
    total -= statSync(join(dir, f)).size;
    rmSync(join(dir, f));
  }
}

// VS Code's telemetry lines that belong to a chat, without its repeating metrics or background
// model calls (those have no conversation id). Field values stay as VS Code wrote them.
export function usefulTelemetry(raw: string): object[] {
  const out: object[] = [];
  for (const l of raw.split("\n")) {
    if (!l) continue;
    try {
      const e = JSON.parse(l);
      const a = e.attributes as Record<string, unknown> | undefined;
      const session = a?.["gen_ai.conversation.id"];
      if (!a || e.scopeMetrics || typeof session !== "string") continue;
      const attrs = Object.fromEntries(
        Object.entries(a).filter(([k]) =>
          /^(gen_ai\.|copilot_chat\.|github\.copilot\.|error\.)/.test(k),
        ),
      );
      const ms = Array.isArray(e.hrTime) ? e.hrTime[0] * 1000 + e.hrTime[1] / 1e6 : undefined;
      out.push({
        v: LOG_VERSION,
        event: "telemetry",
        session,
        time: ms ? new Date(ms).toISOString() : undefined,
        name: e.body ?? e.name,
        attrs,
      });
    } catch {}
  }
  return out;
}

function moveTelemetry(home: string, today: string) {
  const file = telemetryFile(home);
  if (!existsSync(file)) return;
  if (statSync(file).size <= MAX_TELEMETRY) {
    const lines = usefulTelemetry(readFileSync(file, "utf8"));
    if (lines.length)
      appendFileSync(
        dayFile(home, today),
        lines.map((l) => `${JSON.stringify(clean(l))}\n`).join(""),
        {
          mode: 0o600,
        },
      );
  }
  writeFileSync(file, ""); // in place: VS Code keeps appending to the same file
}
