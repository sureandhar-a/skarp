import * as os from "node:os";
import * as path from "node:path";
import type { Core } from "@skarp/core";
import * as vscode from "vscode";
import { GEMINI_KEY } from "../adapters/model-choice";
import { ValidateAndParse } from "../validator";

const SETTINGS = new Set([
  "settings",
  "open_folder",
  "set_gemini_key",
  "set_model",
  "export",
  "import",
]);

// The skarp area: skarp's own controls and your data. Rules stay in core.
export class AreaView implements vscode.WebviewViewProvider {
  private web?: vscode.Webview;

  constructor(
    private readonly root: vscode.Uri,
    private readonly core: Core,
    private readonly openChat: (session_id: string) => void,
    private readonly onDataChanged: () => void, // the chat starts fresh after import or delete all
    private readonly secrets: vscode.SecretStorage,
  ) {}

  // Settings: file dialogs and VS Code settings are the extension's job; data goes through core.
  private async settings(kind: string, raw: { model?: unknown }) {
    const web = this.web;
    if (!web) return;
    const config = vscode.workspace.getConfiguration("skarp");
    if (kind === "open_folder") {
      const home = vscode.Uri.file(path.join(os.homedir(), ".skarp"));
      return vscode.commands.executeCommand("revealFileInOS", home);
    }
    if (kind === "set_gemini_key") await vscode.commands.executeCommand("skarp.setGeminiKey");
    if (kind === "set_model" && (raw.model === "copilot" || raw.model === "gemini")) {
      await config.update("model", raw.model, vscode.ConfigurationTarget.Global);
    }
    if (kind === "export") {
      const name = `skarp-export-${new Date().toISOString().slice(0, 10)}.json`;
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), name)),
        filters: { "skarp export": ["json"] },
      });
      const [out] = await this.core.handle({ kind: "export_data" });
      if (target && out?.kind === "data" && out.bundle) {
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(out.bundle));
        vscode.window.showInformationMessage(
          `skarp: exported ${out.events} events and ${out.chats} chats.`,
        );
      }
    }
    if (kind === "import") {
      const [source] =
        (await vscode.window.showOpenDialog({ filters: { "skarp export": ["json"] } })) ?? [];
      if (source) {
        const bundle = new TextDecoder().decode(await vscode.workspace.fs.readFile(source));
        for (const out of await this.core.handle({ kind: "import_data", bundle })) {
          await web.postMessage(out);
        }
        this.onDataChanged();
      }
    }
    await web.postMessage({
      kind: "settings",
      model: config.get("model") ?? "copilot",
      geminiKey: Boolean(await this.secrets.get(GEMINI_KEY)),
    });
    for (const out of await this.core.handle({ kind: "get_data" })) await web.postMessage(out);
  }

  // the chat calls this after each message, so the area stays in step
  async refresh() {
    if (!this.web) return;
    for (const out of await this.core.handle({ kind: "get_area" })) await this.web.postMessage(out);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    const web = view.webview;
    this.web = web;
    web.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.root, "out")],
    };
    const script = web.asWebviewUri(vscode.Uri.joinPath(this.root, "out", "webview", "main.js"));
    const style = web.asWebviewUri(vscode.Uri.joinPath(this.root, "out", "webview", "main.css"));
    view.onDidChangeVisibility(() => view.visible && this.refresh());

    // untrusted until validated, like the chat
    web.onDidReceiveMessage(async (raw: unknown) => {
      if ((raw as { kind?: unknown } | null)?.kind === "ready") {
        const folder = vscode.workspace.workspaceFolders?.[0];
        await web.postMessage({
          kind: "project",
          name: folder ? path.basename(folder.uri.fsPath) : "No folder",
        });
        return this.refresh();
      }
      const r = raw as { kind?: unknown; session_id?: unknown; model?: unknown } | null;
      if (r?.kind === "open_chat" && typeof r.session_id === "string")
        return this.openChat(r.session_id);
      if (typeof r?.kind === "string" && SETTINGS.has(r.kind)) return this.settings(r.kind, r);
      const msg = ValidateAndParse(raw, "");
      if (!msg) return web.postMessage({ kind: "error", message: "Malformed message received" });
      for (const out of await this.core.handle(msg)) await web.postMessage(out);
      if (msg.kind === "delete_all") this.onDataChanged();
    });

    web.html = `
    <!doctype html>
    <html>
    <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${web.cspSource}; font-src ${web.cspSource}; script-src ${web.cspSource};">
    <link rel="stylesheet" href="${style}">
    </head>
    <body>
    <div id="root" data-view="area">
    </div>
    <script type="module" src="${script}">
    </script>
    </body>
    </html>`;
  }
}
