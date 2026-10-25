import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ModelMessage, ModelPort, ModelResult, ToolSpec } from "@skarp/core";
import { generateText, jsonSchema, type ModelMessage as SdkMessage, tool } from "ai";

// Gemini through the AI SDK with your own key. The key comes from SecretStorage, never settings.
export class GeminiModel implements ModelPort {
  constructor(
    private readonly getKey: () => Promise<string | undefined>,
    private readonly modelId: string,
  ) {}

  get name() {
    return `gemini:${this.modelId}`;
  }

  async complete(request: {
    messages: ModelMessage[];
    tools?: ToolSpec[];
    signal?: AbortSignal;
  }): Promise<ModelResult> {
    const apiKey = await this.getKey();
    if (!apiKey) throw new Error('No Gemini API key. Run "skarp: Set Gemini API key".');

    const google = createGoogleGenerativeAI({ apiKey });
    // no execute: the SDK returns the tool calls and core runs them
    const tools = Object.fromEntries(
      (request.tools ?? []).map((t) => [
        t.name,
        tool({ description: t.description, inputSchema: jsonSchema(t.parameters) }),
      ]),
    );
    // AI SDK v7 refuses system messages in `messages`; they go in `instructions`
    const instructions = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const { text, toolCalls, usage } = await generateText({
      model: google(this.modelId),
      ...(instructions && { instructions }),
      messages: request.messages.filter((m) => m.role !== "system").map(toSdk),
      tools,
      ...(request.signal && { abortSignal: request.signal }),
    });
    const tool_calls = toolCalls.map((c) => ({
      id: c.toolCallId,
      name: c.toolName,
      input: c.input as Record<string, unknown>,
    }));
    const { inputTokens, outputTokens } = usage;
    return {
      text,
      ...(tool_calls.length && { tool_calls }),
      // never guess a number: usage only when the provider reports both counts
      ...(inputTokens !== undefined &&
        outputTokens !== undefined && {
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        }),
    };
  }
}

function toSdk(m: ModelMessage): SdkMessage {
  if (m.role === "tool") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: m.tool_call_id,
          toolName: m.name,
          output: { type: "text", value: m.content },
        },
      ],
    };
  }
  if (m.role === "assistant" && m.tool_calls) {
    return {
      role: "assistant",
      content: [
        ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
        ...m.tool_calls.map((c) => ({
          type: "tool-call" as const,
          toolCallId: c.id,
          toolName: c.name,
          input: c.input,
        })),
      ],
    };
  }
  return { role: m.role, content: m.content };
}
