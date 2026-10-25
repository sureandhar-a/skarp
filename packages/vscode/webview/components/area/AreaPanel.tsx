import type { Area, Data, OutMessage } from "@skarp/schema";
import {
  AreaHeader,
  Button,
  Confirm,
  Dropdown,
  KnowledgeRow,
  SettingRow,
  SettingsPage,
  SettingsSection,
  ShelfRow,
  Tabs,
} from "@skarp/ui";
import type React from "react";
import { useEffect, useState } from "react";
import { vscode } from "../../vscode";

const MODELS = [
  { value: "copilot", label: "GitHub Copilot", hint: "through VS Code; no key" },
  { value: "gemini", label: "Google Gemini", hint: "your own API key; free tier works" },
];

// what skarp keeps about you, in plain words
const KEPT = [
  "The ledger: what happened in each chat (asks, your answers, the AI's tool calls, runs)",
  "Chat transcripts, edits waiting for Accept, and Undo snapshots (D99)",
  "Which folders you've shown you understand, for lighter asks",
];

const EMPTY: Area = { kind: "area", stopped: false, shelf: [], knowledge: [] };

// The skarp area: header, then Shelf, Knowledge. Everything stays usable when stopped.
export const AreaPanel: React.FC = () => {
  const [project, setProject] = useState("");
  const [area, setArea] = useState<Area>(EMPTY);
  const [tab, setTab] = useState("shelf");
  const [settings, setSettings] = useState(false);
  const [model, setModel] = useState("copilot");
  const [geminiKey, setGeminiKey] = useState(false);
  const [data, setData] = useState<Data>();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as
        | OutMessage
        | { kind: "project"; name: string }
        | { kind: "settings"; model: string; geminiKey: boolean };
      if (message.kind === "project") setProject(message.name);
      if (message.kind === "area") setArea(message);
      if (message.kind === "settings") {
        setModel(message.model);
        setGeminiKey(message.geminiKey);
      }
      if (message.kind === "data") setData(message);
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ kind: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const openSettings = () => {
    setSettings(true);
    vscode.postMessage({ kind: "settings" });
  };

  // the gear opens Settings (<- back)
  if (settings) {
    const cost = data
      ? `This deletes ${data.events} ledger events and ${data.chats} chats on this machine. It can't be undone; export first if you may want them.`
      : "This deletes everything skarp keeps on this machine.";
    return (
      <div className="flex h-screen flex-col overflow-y-auto bg-surface text-text">
        <SettingsPage onBack={() => setSettings(false)}>
          <SettingsSection title="Model">
            <SettingRow label="Provider">
              <Dropdown
                label="Model"
                options={MODELS}
                value={model}
                onChange={(m) => {
                  setModel(m);
                  vscode.postMessage({ kind: "set_model", model: m });
                }}
              />
            </SettingRow>
            {model === "gemini" && (
              <SettingRow label="API key">
                <span className="flex items-center gap-2">
                  <span className="text-small text-text-muted">
                    {geminiKey ? "Saved" : "Not set"}
                  </span>
                  <Button onClick={() => vscode.postMessage({ kind: "set_gemini_key" })}>
                    {geminiKey ? "Change key" : "Set Gemini key"}
                  </Button>
                </span>
              </SettingRow>
            )}
          </SettingsSection>
          <SettingsSection title="Your data">
            <SettingRow label="Stored in">
              <span className="flex items-center gap-2">
                <code>~/.skarp</code>
                <Button variant="quiet" onClick={() => vscode.postMessage({ kind: "open_folder" })}>
                  Open folder
                </Button>
              </span>
            </SettingRow>
            <ul className="m-0 flex flex-col gap-1 pl-4 text-small text-text-muted">
              {KEPT.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            {data && (
              <p className="m-0 text-small text-text-muted">
                Now: {data.events} ledger events · {data.chats} chats
              </p>
            )}
            <span className="flex flex-wrap gap-2">
              <Button onClick={() => vscode.postMessage({ kind: "export" })}>Export all</Button>
              <Button onClick={() => vscode.postMessage({ kind: "import" })}>Import</Button>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Delete all
              </Button>
            </span>
            {confirming && (
              // the cost first, inline
              <Confirm
                cost={cost}
                confirmLabel="Delete all"
                onConfirm={() => {
                  setConfirming(false);
                  vscode.postMessage({ kind: "delete_all" });
                }}
                onCancel={() => setConfirming(false)}
              />
            )}
          </SettingsSection>
        </SettingsPage>
      </div>
    );
  }

  // an empty tab shows one faint hint
  const empty = <p className="m-0 text-small text-text-muted">Nothing yet</p>;

  return (
    <div className="flex h-screen flex-col bg-surface text-text">
      <AreaHeader
        project={project}
        stopped={area.stopped}
        onToggleStop={() => vscode.postMessage({ kind: "stop_everywhere", stopped: !area.stopped })}
        onSettings={openSettings}
      />
      {area.stopped && (
        <div role="status" className="px-3 py-1.5 text-small text-warning">
          skarp is stopped everywhere: it asks nothing until you turn it back on.
        </div>
      )}
      <Tabs
        tabs={[
          { id: "shelf", label: "Shelf", count: area.shelf.length || undefined },
          { id: "knowledge", label: "Knowledge" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="flex flex-col gap-0.5 overflow-y-auto p-3">
        {tab === "shelf" &&
          (area.shelf.length
            ? area.shelf.map((item) => (
                <ShelfRow
                  key={item.id}
                  kind={item.kind}
                  title={item.kind === "not-run" ? <code>{item.title}</code> : item.title}
                  meta={item.meta}
                  actions={[
                    {
                      label: "Open chat",
                      onClick: () =>
                        vscode.postMessage({ kind: "open_chat", session_id: item.session_id }),
                    },
                  ]}
                  onDelete={() => vscode.postMessage({ kind: "dismiss", ref: item.id })}
                />
              ))
            : empty)}
        {tab === "knowledge" &&
          (area.knowledge.length
            ? area.knowledge.map((k) => (
                <KnowledgeRow
                  key={k.concept}
                  name={k.concept.split("/").at(-1) || k.concept}
                  folder={k.concept}
                  stage={k.stage}
                  depth={k.depth}
                />
              ))
            : empty)}
      </div>
    </div>
  );
};
