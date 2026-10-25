// Ports: what the core needs from the world. Adapters implement these.
export interface ModelPort {
  readonly name: string; // e.g. "copilot:gpt-4o"; written into model_call events
  // set when the model shown by name is another model underneath, e.g. "GPT-4.1 runs as
  // copilot-utility"; said once in the chat
  readonly note?: string;
  complete(request: {
    messages: ModelMessage[];
    tools?: ToolSpec[];
    signal?: AbortSignal; // Stop
  }): Promise<ModelResult>;
}
// usage only when the provider reports it; never guess a number.
export interface ModelResult {
  text: string;
  tool_calls?: ToolCall[];
  usage?: { input_tokens: number; output_tokens: number };
  // the adapter ran another model than the one picked; core logs it and says so in the chat
  switched?: { from: string; to: string; reason: string };
}
export interface ObservationPort {
  record(toolCall: { name: string; input: unknown; output: unknown }): void;
}
// Paths are workspace-relative and already checked by the kernel's pathAllowed.
export interface RepoPort {
  readFile(path: string): Promise<string>;
  listFiles(glob: string): Promise<string[]>;
  search(query: string): Promise<{ path: string; line: number; text: string }[]>;
  gitInfo(commit?: string): Promise<string>; // with a commit: that commit's message and diff
}
// runs one approved project command in the workspace; the core asks first.
export interface RunPort {
  run(command: string): Promise<{ exit_code: number; output: string }>;
  stop?(): void; // Stop: end the running command now
}
// writes accepted edits through the editor, so its Undo works. null deletes the file.
export interface EditPort {
  apply(changes: { path: string; content: string | null }[]): Promise<void>;
}
// one saved file per chat, so a restart picks up where you left off.
export interface SessionStore {
  save(id: string, data: string): Promise<void>;
  load(id: string): Promise<string | undefined>;
  list(): Promise<string[]>; // session ids
  remove(id: string): Promise<void>;
}
export interface StoragePort {
  append(file: string, line: string): Promise<void>;
  readAll(dir: string): Promise<string[]>;
  removeAll(dir: string): Promise<void>; // Delete all
}
export interface ClockPort {
  now(): Date;
}
export interface EmbedPort {
  embed(text: string): Promise<number[]>;
}
export interface AskPort {
  ask(sessionId: string, spec: unknown): Promise<unknown>;
}

export interface Ports {
  model: ModelPort;
  observation: ObservationPort;
  repo: RepoPort;
  run: RunPort;
  edits: EditPort;
  storage: StoragePort;
  sessions: SessionStore;
  clock: ClockPort;
  ask: AskPort;
  embed?: EmbedPort; // not used in release 1
  random?: () => number; // for the control-chat coin flip; Math.random by default
}

// internal models
export type ModelMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: object; // JSON Schema of the input
}
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
