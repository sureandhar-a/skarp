import type { Block } from "@skarp/kernel";
import type { ModelPort, ModelResult } from "./ports.ts";

export interface Words {
  question_text: string;
  answer_type: Block["answer_type"];
  choices?: string[];
  correct?: string; // the right choice, for a graded block; never shown before the answer
  from: "model" | "fallback"; // which rung ran, logged with the ask
}

// code picked the block; the model only writes its words, from the block's brief.
// Any failure falls back to the block's own fixed words, so an ask never waits on the model.
export async function writeWords(
  model: ModelPort,
  block: Block,
  context: string,
  onCall: (result: ModelResult) => Promise<void>,
  signal?: AbortSignal,
): Promise<Words> {
  const fallback: Words = {
    question_text: block.question_text,
    answer_type: "text", // fixed words have no choices to tap
    from: "fallback",
  };
  const shape =
    block.answer_type === "order"
      ? '{"question": "...", "steps": ["first", "second", "third"]}'
      : block.answer_type !== "choice"
        ? '{"question": "..."}'
        : block.graded
          ? '{"question": "...", "choices": ["...", "...", "..."], "correct": 0}'
          : '{"question": "...", "choices": ["...", "...", "..."]}';
  const prompt = [
    "Write one short question for the user, about their own task below. Do not answer it or hint at the answer. Don't ask for anything the user already said, and ask only about this project's code.",
    `The question must: ${block.brief}`,
    `Task context:\n${context.slice(0, 4000)}`,
    `Reply with JSON only: ${shape}`,
  ].join("\n\n");

  try {
    const messages = [{ role: "user" as const, content: prompt }];
    const result = await model.complete({ messages, ...(signal && { signal }) });
    await onCall(result);
    const json = JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] ?? "");
    if (typeof json.question !== "string" || !json.question.trim()) return fallback;
    // a blank inside a question ("specifically regarding ___?") can't be answered
    if (/_{3,}[^?]*\?\s*$/.test(json.question)) return fallback;
    if (block.answer_type === "text") {
      return { question_text: json.question, answer_type: "text", from: "model" };
    }
    if (block.answer_type === "order") {
      // the steps come in order; they're shown moved one along, and the order is the answer
      const steps = Array.isArray(json.steps)
        ? json.steps.filter((c: unknown) => typeof c === "string" && c.trim())
        : [];
      if (steps.length < 3 || steps.length > 5 || new Set(steps).size !== steps.length)
        return fallback;
      return {
        question_text: json.question,
        answer_type: "order",
        choices: [...steps.slice(1), steps[0]],
        correct: steps.join(" → "),
        from: "model",
      };
    }
    const choices = Array.isArray(json.choices)
      ? json.choices.filter((c: unknown) => typeof c === "string" && c.trim())
      : [];
    if (choices.length < 2 || choices.length > 4) return fallback;
    const correct = block.graded ? choices[json.correct] : undefined;
    if (block.graded && typeof correct !== "string") return fallback; // ungradable: the text ask grades
    return {
      question_text: json.question,
      answer_type: "choice",
      choices,
      ...(correct !== undefined && { correct }),
      from: "model",
    };
  } catch {
    return fallback;
  }
}
