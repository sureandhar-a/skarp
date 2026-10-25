import {
  fitHistory,
  type ModelMessage,
  type ModelPort,
  type ModelResult,
  type ToolCall,
  type ToolSpec,
} from "@skarp/core";
import * as vscode from "vscode";
import { copilotModels, mapped, refuse, usable } from "./model-choice";

// Copilot through VS Code's Language Model API. vscode.lm reports no usage, so tokens are
// counted with the model's own tokenizer (countTokens), never guessed.
export class CopilotModel implements ModelPort {
  name = "copilot";
  note: string | undefined;

  async complete(request: {
    messages: ModelMessage[];
    tools?: ToolSpec[];
    signal?: AbortSignal;
  }): Promise<ModelResult> {
    // the chat's model picker sets skarp.copilotModel; empty or gone means the first one
    const config = vscode.workspace.getConfiguration("skarp");
    const id = config.get<string>("copilotModel");
    const all = await copilotModels();
    // a picked model that isn't listed yet may only be late to register: ask for it by id
    const late = id && usable(id) && !all.some((m) => m.id === id) ? await byId(id) : undefined;
    const model = all.find((m) => m.id === id) ?? late ?? all[0];
    if (!model) throw new Error("No Copilot model available. Sign in to GitHub Copilot.");
    this.name = `copilot:${model.id}`;
    this.note = mapped(model) ? `${model.name} (${model.id})` : undefined;
    const switched =
      id && model.id !== id
        ? { from: id, to: model.id, reason: `${id} is not open to skarp in this window` }
        : undefined;

    const tools = (request.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
    }));
    // Stop: vscode.lm cancels by token, not by AbortSignal
    const cancel = new vscode.CancellationTokenSource();
    request.signal?.addEventListener("abort", () => cancel.cancel());
    try {
      // about 4 characters a token, with a quarter spare for the tools and the reply
      const budget = model.maxInputTokens > 0 ? model.maxInputTokens * 3 : Infinity;
      const messages = fitHistory(request.messages, budget);
      const lm = messages.map(toLm);
      const response = await model.sendRequest(lm, { tools }, cancel.token);
      let text = "";
      const tool_calls: ToolCall[] = [];
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) text += part.value;
        if (part instanceof vscode.LanguageModelToolCallPart) {
          tool_calls.push({
            id: part.callId,
            name: part.name,
            input: part.input as ToolCall["input"],
          });
        }
      }
      const usage = await countUsage(model, lm, text, tool_calls, cancel.token);
      return {
        text,
        ...(tool_calls.length && { tool_calls }),
        ...(usage && { usage }),
        ...(switched && { switched }),
      };
    } catch (error) {
      // Some listed models are kept for VS Code's own chat. Hide it for good, move your
      // setting to the next usable model, say so once, and retry, so the picker and the model in
      // use always agree and the chat carries on.
      if (!/only available to VS Code core/i.test(String(error))) throw error;
      await refuse(model.id);
      const next = (await copilotModels())[0];
      if (!next) {
        throw new Error(
          `${model.name} is kept for VS Code's own chat, and no other Copilot model is open to skarp.`,
        );
      }
      await config.update("copilotModel", next.id, vscode.ConfigurationTarget.Global);
      // said in the chat and the ledger by core, not only in a toast that's easy to miss
      const result = await this.complete(request);
      return {
        ...result,
        switched: {
          from: model.id,
          to: next.id,
          reason: `${model.name} is kept for VS Code's own chat`,
        },
      };
    }
  }
}

// vscode.lm has no system or tool role: system text goes in as a user message,
// tool results as a user message carrying a tool result part.
function toLm(m: ModelMessage): vscode.LanguageModelChatMessage {
  if (m.role === "tool") {
    return vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelToolResultPart(m.tool_call_id, [
        new vscode.LanguageModelTextPart(m.content),
      ]),
    ]);
  }
  if (m.role === "assistant") {
    return vscode.LanguageModelChatMessage.Assistant([
      ...(m.content ? [new vscode.LanguageModelTextPart(m.content)] : []),
      ...(m.tool_calls ?? []).map(
        (c) => new vscode.LanguageModelToolCallPart(c.id, c.name, c.input),
      ),
    ]);
  }
  return vscode.LanguageModelChatMessage.User(m.content);
}

const byId = (id: string) =>
  vscode.lm.selectChatModels({ vendor: "copilot", id }).then(
    (models) => models[0],
    () => undefined,
  );

// The model's own count of what went in and came out; nothing when it can't count.
async function countUsage(
  model: vscode.LanguageModelChat,
  input: vscode.LanguageModelChatMessage[],
  text: string,
  calls: ToolCall[],
  token: vscode.CancellationToken,
): Promise<ModelResult["usage"]> {
  try {
    const counts = await Promise.all(input.map((m) => model.countTokens(m, token)));
    const out = text + calls.map((c) => c.name + JSON.stringify(c.input)).join("");
    return {
      input_tokens: counts.reduce((a, b) => a + b, 0),
      output_tokens: await model.countTokens(out, token),
    };
  } catch {
    return undefined;
  }
}
