import type { ModelMessage } from "./ports.ts";

const KEEP = 500; // characters kept from a cut tool output
const NOTE =
  "\n[skarp: the rest was cut to fit the model's limit; call the tool again if you need it]";

// Fits the chat into a model's input limit: the oldest
// long tool outputs are cut first, the latest message never. `maxChars` is the model's budget.
// limit: about 4 characters per token, no tokenizer; count tokens if a model still overflows.
export function fitHistory(messages: ModelMessage[], maxChars: number): ModelMessage[] {
  const out = [...messages];
  let total = out.reduce((n, m) => n + m.content.length, 0);
  for (let i = 0; i < out.length - 1 && total > maxChars; i++) {
    const m = out[i] as ModelMessage;
    if (m.role !== "tool" || m.content.length <= KEEP + NOTE.length) continue;
    const content = m.content.slice(0, KEEP) + NOTE;
    total -= m.content.length - content.length;
    out[i] = { ...m, content };
  }
  return out;
}
