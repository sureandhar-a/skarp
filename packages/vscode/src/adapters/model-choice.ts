import * as vscode from "vscode";

export const GEMINI_KEY = "skarp.geminiKey";

export interface ModelOption {
  value: string; // "copilot:<id>" or "gemini"
  label: string;
}

// Models VS Code lists but won't run for extensions, learned when one refuses, and
// remembered across windows, so each one fails at most once ever.
const REFUSED = "skarp.refusedModels";
let memory: vscode.Memento | undefined;
const refused = new Set<string>();
export const modelsChanged = new vscode.EventEmitter<void>();

export function rememberRefused(state: vscode.Memento) {
  memory = state;
  for (const id of state.get<string[]>(REFUSED, [])) refused.add(id);
}

export async function refuse(id: string) {
  refused.add(id);
  await memory?.update(REFUSED, [...refused]);
  modelsChanged.fire();
}

// a name that isn't its id ("GPT-4.1" served as copilot-utility) is shown with the id
export const mapped = (m: { name: string; id: string }) =>
  !m.id.toLowerCase().startsWith(m.name.toLowerCase().replace(/\s+/g, "-"));

export const usable = (id: string) => id !== "auto" && !refused.has(id);

// The Copilot models skarp can use. "auto" is Copilot chat's own router: it fails once the AI
// has used a tool, so it is left out.
export async function copilotModels(): Promise<vscode.LanguageModelChat[]> {
  const all = await vscode.lm.selectChatModels({ vendor: "copilot" }).then(
    (models) => models,
    () => [],
  );
  // a fixed order, so the first one (the fallback) is the same every time; utility
  // models come last, as they are meant for small jobs
  const rank = (m: vscode.LanguageModelChat) => `${Number(/utility/i.test(m.id))}${m.id}`;
  return all.filter((m) => usable(m.id)).sort((a, b) => rank(a).localeCompare(rank(b)));
}

// a model can register after the window opens; the picker follows when the list changes
export function watchModels(): vscode.Disposable {
  return vscode.lm.onDidChangeChatModels(() => modelsChanged.fire());
}

// The chat's model picker: the Copilot models your plan gives skarp, plus Gemini once a key is set.
export async function listModels(secrets: vscode.SecretStorage): Promise<ModelOption[]> {
  const copilot = await copilotModels();
  // two models can share a name; the id tells them apart
  const named = (name: string) => copilot.filter((m) => m.name === name).length;
  const options = copilot.map((m) => ({
    value: `copilot:${m.id}`,
    label: named(m.name) > 1 || mapped(m) ? `${m.name} · ${m.id}` : m.name,
  }));
  if (await secrets.get(GEMINI_KEY)) {
    const id = vscode.workspace.getConfiguration("skarp").get<string>("geminiModel");
    options.push({ value: "gemini", label: `Gemini (${id ?? "gemini-3.6-flash"})` });
  }
  return options;
}

// What the picker shows: the model really used. A Copilot pick that is hidden or gone (an old
// "auto") falls back to the first usable one, as the Copilot adapter does.
export function currentModel(options: ModelOption[]): string {
  const config = vscode.workspace.getConfiguration("skarp");
  if (config.get<string>("model") === "gemini") return "gemini";
  const picked = `copilot:${config.get<string>("copilotModel") ?? ""}`;
  const copilot = options.filter((o) => o.value.startsWith("copilot:"));
  return copilot.some((o) => o.value === picked) ? picked : (copilot[0]?.value ?? picked);
}

// The webview is untrusted: only a value from the list is saved.
export async function pickModel(value: unknown, secrets: vscode.SecretStorage) {
  const options = await listModels(secrets);
  if (!options.some((o) => o.value === value)) return;
  const config = vscode.workspace.getConfiguration("skarp");
  const target = vscode.ConfigurationTarget.Global;
  if (value === "gemini") return config.update("model", "gemini", target);
  await config.update("copilotModel", String(value).slice("copilot:".length), target);
  await config.update("model", "copilot", target);
}
