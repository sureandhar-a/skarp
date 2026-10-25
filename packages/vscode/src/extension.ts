import * as os from "node:os";
import * as path from "node:path";
import { createCore, FileSessions, type ModelPort, type Ports, Storage } from "@skarp/core";
import * as vscode from "vscode";
import { CopilotModel } from "./adapters/copilot-model";
import { FakeEchoModel } from "./adapters/fake-model";
import { GeminiModel } from "./adapters/gemini-model";
import { GEMINI_KEY, rememberRefused, watchModels } from "./adapters/model-choice";
import { TerminalRun } from "./adapters/terminal-run";
import { HeldDocs, WorkspaceEdits } from "./adapters/workspace-edits";
import { WorkspaceRepo } from "./adapters/workspace-repo";
import { AreaView } from "./WebViewProvider/AreaView";
import { ChatView } from "./WebViewProvider/ChatView";

// Release 1: core runs in-process here, one per window. Adapters for Model/Repo/Storage/Ask go in src/adapters/.
export function activate(context: vscode.ExtensionContext) {
  rememberRefused(context.globalState);
  const ports = createPorts(context);
  const home = os.homedir();
  const writerId = crypto.randomUUID();
  const ledgerPath = path.join(home, ".skarp", "ledger", `${writerId}.jsonl`);
  const core = createCore(ports, ledgerPath);
  const heldDocs = new HeldDocs();
  const area: AreaView = new AreaView(
    context.extensionUri,
    core,
    (id) => chat.open(id),
    () => chat.reset(),
    context.secrets,
  );
  const chat = new ChatView(
    context.extensionUri,
    core,
    heldDocs,
    () => area.refresh(),
    context.secrets,
  );

  // Regestering webview providers
  context.subscriptions.push(
    watchModels(),
    // chatview provider
    vscode.window.registerWebviewViewProvider("skarp.chat", chat),
    vscode.workspace.registerTextDocumentContentProvider(HeldDocs.scheme, heldDocs),
    // areaview provider
    vscode.window.registerWebviewViewProvider("skarp.area", area),
    vscode.commands.registerCommand("skarp.setGeminiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Gemini API key (stored in VS Code's SecretStorage)",
        password: true,
        ignoreFocusOut: true,
      });
      if (key) await context.secrets.store(GEMINI_KEY, key.trim());
      await chat.postModels(); // Gemini joins the picker
    }),
  );
}

// The skarp.model setting is read on every call, so switching models needs no reload.
function selectedModel(context: vscode.ExtensionContext): ModelPort {
  const config = vscode.workspace.getConfiguration("skarp");
  switch (config.get<string>("model")) {
    case "gemini":
      return new GeminiModel(
        async () => context.secrets.get(GEMINI_KEY),
        config.get<string>("geminiModel") ?? "gemini-3.6-flash",
      );
    case "fake":
      return new FakeEchoModel();
    default:
      return new CopilotModel();
  }
}

function createPorts(context: vscode.ExtensionContext): Ports {
  let current: ModelPort = selectedModel(context);
  const ports: Ports = {
    storage: new Storage(),
    model: {
      get name() {
        return current.name;
      },
      get note() {
        return current.note;
      },
      complete(request) {
        current = selectedModel(context);
        return current.complete(request);
      },
    },
    clock: {
      now: () => new Date(),
    },
    observation: { record: () => {} },
    repo: new WorkspaceRepo(),
    run: new TerminalRun(),
    edits: new WorkspaceEdits(),
    sessions: new FileSessions(path.join(os.homedir(), ".skarp", "sessions")),
    ask: { ask: async () => ({ type: "skip" }) },
  };

  return ports;
}

export function deactivate() {}
