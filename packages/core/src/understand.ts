import { conceptOf, pathAllowed, type Target } from "@skarp/kernel";
import type { ModelPort, ModelResult, RepoPort } from "./ports.ts";

// One piece of an understand chat: a few files a newcomer can learn in one go.
export interface Piece {
  name: string;
  files: string[];
  for_task?: boolean; // the task in the message needs this piece understood first
}

const MAX_PIECES = 3; // the card holds 4 buttons; one is "Big picture first"

// The files a target covers: a commit's changed files, a folder's files, or the repo's.
export async function targetFiles(target: Target, repo: RepoPort): Promise<string[]> {
  if (target.kind === "commit") {
    const show = await repo.gitInfo(target.ref).catch(() => "");
    return [...show.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1] ?? "").filter(pathAllowed);
  }
  if (target.kind === "path") {
    const inside = await repo.listFiles(`${target.path}/**/*`).catch(() => []);
    if (inside.length) return inside.filter(pathAllowed);
    if (!pathAllowed(target.path)) return [];
    const exists = await repo.readFile(target.path).then(
      () => true,
      () => false,
    );
    return exists ? [target.path] : [];
  }
  return (await repo.listFiles("**/*").catch(() => [])).filter(pathAllowed);
}

// the model names the pieces; code keeps only files that are really in the list.
// Any failure falls back to folders, so the opening never waits on the model.
export async function groupPieces(
  files: string[],
  task: string | undefined,
  model: ModelPort,
  onCall: (result: ModelResult) => Promise<void>,
  signal?: AbortSignal,
): Promise<Piece[]> {
  if (files.length <= 1) return files.map((f) => ({ name: f.split("/").pop() ?? f, files: [f] }));
  const prompt = [
    `Group these files into at most ${MAX_PIECES} pieces a newcomer can learn one at a time.`,
    "Name each piece in 2-4 plain words for what it does (not the folder name). Every file goes in one piece.",
    task ? `Mark "for_task": true on the pieces this task needs understood first: ${task}` : "",
    // limit: 150 paths in the prompt; a huge repo groups by what fits
    `Files:\n${files.slice(0, 150).join("\n")}`,
    'Reply with JSON only: {"pieces": [{"name": "...", "files": ["..."], "for_task": false}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const messages = [{ role: "user" as const, content: prompt }];
    const result = await model.complete({ messages, ...(signal && { signal }) });
    await onCall(result);
    const json = JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] ?? "");
    const known = new Set(files);
    const pieces: Piece[] = [];
    for (const p of Array.isArray(json.pieces) ? json.pieces : []) {
      const name = typeof p?.name === "string" ? p.name.trim().slice(0, 40) : "";
      const mine = Array.isArray(p?.files)
        ? p.files.filter((f: unknown) => known.has(f as string))
        : [];
      if (!name || !mine.length || pieces.some((q) => q.name === name)) continue;
      pieces.push({ name, files: mine, ...(task && p.for_task === true && { for_task: true }) });
    }
    if (pieces.length) return pieces.slice(0, MAX_PIECES);
  } catch {
    // fall through to folders
  }
  return byFolder(files);
}

// Fallback: one piece per folder, biggest first; past 3, the rest share one piece.
export function byFolder(files: string[]): Piece[] {
  const folders = new Map<string, string[]>();
  for (const f of files) {
    const c = conceptOf(f);
    folders.set(c, [...(folders.get(c) ?? []), f]);
  }
  const pieces = [...folders]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([c, fs]) => ({ name: c === "." ? "Top level" : c, files: fs }));
  if (pieces.length <= MAX_PIECES) return pieces;
  const rest = pieces.slice(MAX_PIECES - 1).flatMap((p) => p.files);
  return [...pieces.slice(0, MAX_PIECES - 1), { name: "Everything else", files: rest }];
}
