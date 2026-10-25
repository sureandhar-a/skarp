import type { EditPort } from "@skarp/core";
import * as vscode from "vscode";

// accepted edits go through VS Code's own edit system, so Undo works and open
// editors stay in step; then they are saved, so a Check runs against what's on disk.
export class WorkspaceEdits implements EditPort {
  async apply(changes: { path: string; content: string | null }[]) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error("Open a folder first.");
    const edit = new vscode.WorkspaceEdit();
    const saves: vscode.Uri[] = [];
    for (const { path, content } of changes) {
      const uri = vscode.Uri.joinPath(folder.uri, path);
      if (content === null) {
        edit.deleteFile(uri, { ignoreIfNotExists: true });
        continue;
      }
      const exists = await vscode.workspace.fs.stat(uri).then(
        () => true,
        () => false,
      );
      if (exists) {
        const doc = await vscode.workspace.openTextDocument(uri);
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), content);
      } else {
        edit.createFile(uri, { contents: new TextEncoder().encode(content) });
      }
      saves.push(uri);
    }
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error("VS Code refused the edit.");
    for (const uri of saves) await vscode.workspace.save(uri);
    // an editor save can report success with nothing on disk. Check the disk; if the editor's
    // save didn't land, write the file directly, and fail loudly if even that doesn't hold.
    for (const { path, content } of changes) {
      if (content === null) continue;
      const uri = vscode.Uri.joinPath(folder.uri, path);
      if ((await onDisk(uri)) === content) continue;
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
      if ((await onDisk(uri)) !== content) throw new Error(`${path} could not be written.`);
    }
  }
}

const onDisk = (uri: vscode.Uri) =>
  vscode.workspace.fs.readFile(uri).then(
    (bytes) => new TextDecoder().decode(bytes),
    () => null,
  );

// The proposed side of the diff tab: held text served from memory, never written to disk.
export class HeldDocs implements vscode.TextDocumentContentProvider {
  static scheme = "skarp-held";
  private readonly docs = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event; // an open diff tab refreshes when the proposal changes

  set(files: { path: string; content?: string }[]) {
    this.docs.clear();
    for (const f of files) {
      if (f.content === undefined) continue;
      this.docs.set(f.path, f.content);
      this.changed.fire(vscode.Uri.from({ scheme: HeldDocs.scheme, path: `/${f.path}` }));
    }
  }

  provideTextDocumentContent(uri: vscode.Uri) {
    return uri.query === "before" ? "" : (this.docs.get(uri.path.slice(1)) ?? "");
  }

  async openDiff(path: string) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || !this.docs.has(path)) return;
    const file = vscode.Uri.joinPath(folder.uri, path);
    const exists = await vscode.workspace.fs.stat(file).then(
      () => true,
      () => false,
    );
    const held = vscode.Uri.from({ scheme: HeldDocs.scheme, path: `/${path}` });
    const left = exists ? file : held.with({ query: "before" });
    await vscode.commands.executeCommand("vscode.diff", left, held, `${path} ↔ skarp proposal`);
  }
}
