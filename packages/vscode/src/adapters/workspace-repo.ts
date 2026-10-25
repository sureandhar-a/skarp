import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RepoPort } from "@skarp/core";
import * as vscode from "vscode";

const run = promisify(execFile);

// The Repo port over the first workspace folder. Core has already checked every path.
export class WorkspaceRepo implements RepoPort {
  private root() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error("Open a folder first.");
    return folder.uri;
  }

  async readFile(path: string) {
    return new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root(), path)),
    );
  }

  // findFiles skips files.exclude and search.exclude matches
  async listFiles(glob: string, max = 500) {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(this.root(), glob),
      null,
      max,
    );
    return uris.map((u) => vscode.workspace.asRelativePath(u, false));
  }

  // limit: reads up to 2000 files in turn; switch to VS Code's bundled ripgrep if it is slow on big repos.
  async search(query: string) {
    const hits: { path: string; line: number; text: string }[] = [];
    for (const path of await this.listFiles("**/*", 2000)) {
      const text = await this.readFile(path).catch(() => "");
      if (text.includes("\0")) continue; // binary
      text.split("\n").forEach((line, i) => {
        if (line.includes(query)) hits.push({ path, line: i + 1, text: line.trim() });
      });
      if (hits.length >= 50) break;
    }
    return hits.slice(0, 50);
  }

  async gitInfo(commit?: string) {
    const cwd = this.root().fsPath;
    const git = async (...args: string[]) =>
      (await run("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 })).stdout;
    if (commit) return git("show", "--stat", "--patch", commit, "--");
    return `${await git("status", "--short", "--branch")}\n${await git("log", "--oneline", "-5")}`;
  }
}
