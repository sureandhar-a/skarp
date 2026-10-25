import type { ModelMessage, ModelPort, ModelResult } from "@skarp/core";

export class FakeEchoModel implements ModelPort {
  readonly name = "fake-echo";
  async complete(request: { messages: ModelMessage[] }): Promise<ModelResult> {
    const lastMessage = request.messages[request.messages.length - 1];
    const content = lastMessage?.content ?? "";
    return { text: `Echo: ${content}` };
  }
}
