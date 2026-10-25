import type { ModelResult, Ports, SessionStore } from "@skarp/core";

const REPORT = { id: "r", name: "report", input: { least_sure: "scripted", claims: [] } };

// Scripted host: in-memory ports with canned model replies, so tests need no editor or network.
export function scriptedPorts(options: {
  replies: (string | ModelResult)[];
  words?: string[]; // replies to wording calls (no tools); default "" -> fixed words
  throwModelError?: boolean;
}): Ports {
  const ledger: string[] = [];
  return {
    model: {
      name: "scripted",
      complete: async (request) => {
        if (options.throwModelError) {
          throw new Error("Model error");
        }
        if (!request.tools) return { text: options.words?.shift() ?? "" };
        const reply = options.replies.shift() ?? "";
        return {
          // a plain string is a well-behaved turn: the text, then a valid report
          ...(typeof reply === "string" ? { text: reply, tool_calls: [REPORT] } : reply),
          usage: { input_tokens: 3, output_tokens: 2 },
        };
      },
    },
    observation: { record: () => {} },
    repo: {
      readFile: async (path) => `contents of ${path}`,
      listFiles: async () => ["src/a.ts", ".env"],
      search: async () => [],
      gitInfo: async () => "## main",
    },
    storage: {
      append: async (_f, line) => void ledger.push(line),
      readAll: async () => ledger,
      removeAll: async () => void ledger.splice(0),
    },
    run: {
      run: async (command) => ({
        exit_code: command.includes("fail") ? 1 : 0,
        output: `ran ${command}`,
      }),
    },
    edits: { apply: async () => {} },
    sessions: memorySessions(),
    clock: { now: () => new Date(0) },
    random: () => 0.99, // every chat is "on" unless a test says otherwise
    ask: { ask: async () => ({ type: "skip" }) },
  };
}

// The saved chats of one "disk", shared by every core built on these ports.
export function memorySessions(): SessionStore {
  const files = new Map<string, string>();
  return {
    save: async (id, data) => void files.set(id, data),
    load: async (id) => files.get(id),
    list: async () => [...files.keys()],
    remove: async (id) => void files.delete(id),
  };
}
