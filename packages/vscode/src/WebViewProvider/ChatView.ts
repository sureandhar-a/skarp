import type { Core } from "@skarp/core";
import type { OutMessage } from "@skarp/schema";
import * as vscode from "vscode";
import { currentModel, listModels, modelsChanged, pickModel } from "../adapters/model-choice";
import type { HeldDocs } from "../adapters/workspace-edits";
import { ValidateAndParse } from "../validator";

// the messages that show "Working..." in the webview until they're handled
const BUSY = new Set(["user_message", "answer", "run_decision", "finish", "edit_decision"]);

export class ChatView implements vscode.WebviewViewProvider {
  // The chat on screen. The extension owns it; the webview can only ask to switch.
  private current: string = crypto.randomUUID();
  private web?: vscode.Webview;

  // after import or delete all: a fresh chat and the new sessions list
  async reset() {
    if (!this.web) return;
    this.current = crypto.randomUUID();
    this.heldDocs.set([]);
    for (const out of await this.core.handle({ kind: "list_sessions" }))
      await this.web.postMessage(out);
    await this.web.postMessage({
      kind: "session_view",
      session_id: this.current,
      title: "",
      mode: "quick",
      items: [],
    });
  }

  // the skarp area's "Open chat" lands here
  async open(session_id: string) {
    await vscode.commands.executeCommand("skarp.chat.focus");
    if (!this.web) return;
    for (const out of await this.core.handle({ kind: "open_session", session_id })) {
      if (out.kind === "session_view") this.current = out.session_id;
      await this.web.postMessage(out);
    }
  }

  constructor(
    private readonly root: vscode.Uri,
    private readonly core: Core,
    private readonly heldDocs: HeldDocs,
    private readonly onChange: () => void, // the skarp area refreshes after each message
    private readonly secrets: vscode.SecretStorage,
  ) {
    // the skarp area or Settings can change the model too; the picker follows
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("skarp")) this.postModels();
    });
    modelsChanged.event(() => this.postModels());
  }

  // The model picker under the message box (UI-only, like open_diff; the core never sees it)
  async postModels() {
    const items = await listModels(this.secrets);
    await this.web?.postMessage({ kind: "models", items, current: currentModel(items) });
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

    const post = (out: OutMessage) => {
      if (out.kind === "held_edits") {
        // the diff tab keeps the proposed text; the webview only needs paths and counts
        this.heldDocs.set(out.files);
        return web.postMessage({ ...out, files: out.files.map(({ content: _, ...f }) => f) });
      }
      if (out.kind === "session_view") this.current = out.session_id;
      return web.postMessage(out);
    };
    const newChat = async () => {
      this.current = crypto.randomUUID();
      this.heldDocs.set([]);
      await post({
        kind: "session_view",
        session_id: this.current,
        title: "",
        mode: "quick",
        items: [],
      });
    };
    const send = async (msg: Parameters<Core["handle"]>[0]) => {
      const chat = this.current;
      try {
        const reply = await this.core.handle(msg);
        this.onChange();
        // a reply for a chat you've left stays saved there; this one only refreshes the list
        if (chat !== this.current && msg.kind !== "list_sessions") {
          for (const out of await this.core.handle({ kind: "list_sessions" })) await post(out);
          return;
        }
        for (const out of reply) await post(out);
      } catch (error) {
        await post({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // a handled message can end with nothing to show (a closing answer, Finish with skarp
        // off); "Working..." ends here, not on the next reply
        if (BUSY.has(msg.kind)) await web.postMessage({ kind: "idle" });
      }
    };

    // every message from the webview is untrusted; validate against the schema before core sees it.
    web.onDidReceiveMessage(async (_msg: unknown) => {
      const raw = _msg as { kind?: unknown; path?: unknown } | null;
      // opening a diff is the extension's job; only held paths open (HeldDocs checks)
      if (raw?.kind === "open_diff" && typeof raw.path === "string") {
        return this.heldDocs.openDiff(raw.path);
      }
      if (raw?.kind === "new_chat") return newChat();
      if (raw?.kind === "set_chat_model") {
        return pickModel((raw as { value?: unknown }).value, this.secrets);
      }
      if (raw?.kind === "ready") {
        void this.postModels();
        // after a restart, pick up the most recent chat where you left it
        const [list] = await this.core.handle({ kind: "list_sessions" });
        if (list) await post(list);
        const last = list?.kind === "sessions" ? list.items[0] : undefined;
        return last ? send({ kind: "open_session", session_id: last.id }) : newChat();
      }

      const msg = ValidateAndParse(_msg, this.current);
      if (!msg) {
        console.warn("Rejected invalid message from webview:", _msg);
        return web.postMessage({ kind: "error", message: "Malformed message received" });
      }
      await send(msg);
      if (msg.kind === "delete_session" && msg.session_id === this.current) await newChat();
    });

    web.html = `
    <!doctype html>
    <html>
    <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${web.cspSource}; font-src ${web.cspSource}; script-src ${web.cspSource};">
    <link rel="stylesheet" href="${style}">
    </head>
    <body>
    <div id="root" data-view="chat" >
    </div>
    <script type="module" src="${script}">
    </script>
    </body>
    </html>`;
  }
}
