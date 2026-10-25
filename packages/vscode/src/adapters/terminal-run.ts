import { exec } from "node:child_process";
import type { RunPort } from "@skarp/core";
import * as vscode from "vscode";

// approved commands run in a visible terminal named "skarp"; output comes back through shell
// integration. Without it, the command runs in the background and the output says so.
export class TerminalRun implements RunPort {
  private cancel?: () => void; // ends the run in flight (Stop)

  // Ctrl+C in the terminal, and the run returns now even if the command ignores it
  stop() {
    vscode.window.terminals.find((t) => t.name === "skarp")?.sendText("\x03", false);
    this.cancel?.();
  }

  async run(command: string) {
    const stopped = new Promise<{ exit_code: number; output: string }>((resolve) => {
      this.cancel = () => resolve({ exit_code: 130, output: "(stopped by you)" });
    });
    try {
      return await Promise.race([this.start(command), stopped]);
    } finally {
      this.cancel = undefined;
    }
  }

  private async start(command: string) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error("Open a folder first.");
    const cwd = folder.uri.fsPath;

    const terminal =
      vscode.window.terminals.find((t) => t.name === "skarp") ??
      // no pager: `git show` would wait in `less` for a q that never comes
      vscode.window.createTerminal({ name: "skarp", cwd, env: { PAGER: "cat", GIT_PAGER: "cat" } });
    terminal.show(true);
    const shell = terminal.shellIntegration ?? (await shellIntegration(terminal));
    if (!shell) return background(command, cwd);

    const execution = shell.executeCommand(command);
    const exit = new Promise<number>((resolve) => {
      const sub = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution !== execution) return;
        sub.dispose();
        resolve(e.exitCode ?? -1);
      });
    });
    let output = "";
    for await (const data of execution.read()) output += data;
    return { exit_code: await exit, output: stripAnsi(output) };
  }
}

// Shell integration can take a moment to start in a new terminal.
function shellIntegration(terminal: vscode.Terminal) {
  return new Promise<vscode.TerminalShellIntegration | undefined>((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(undefined);
    }, 3000);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal !== terminal) return;
      clearTimeout(timer);
      sub.dispose();
      resolve(e.shellIntegration);
    });
  });
}

// limit: Stop returns at once but a background command keeps running; kill the child if that bites.
function background(command: string, cwd: string) {
  return new Promise<{ exit_code: number; output: string }>((resolve) => {
    exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        exit_code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        output: `(ran in the background: shell integration was not available)\n${stdout}${stderr}`,
      });
    });
  });
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape codes
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;
const stripAnsi = (text: string) => text.replace(ANSI, "");
