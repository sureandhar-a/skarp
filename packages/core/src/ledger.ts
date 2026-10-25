import type { LedgerEvent } from "@skarp/schema";
import type { ClockPort } from "./ports.ts";

type EventType = LedgerEvent["type"];

// One provenance and one reason per type (week 2, Day 9). Shown in the Knowledge view later.
const RULES: Record<EventType, { provenance: LedgerEvent["provenance"]; why_kept: string }> = {
  user_message: {
    provenance: "typed",
    why_kept: "So you can see what you asked, in order, for each session.",
  },
  ask: {
    provenance: "observed",
    why_kept: "So you can see which question skarp asked, and that it came before the AI answered.",
  },
  answer: {
    provenance: "typed",
    why_kept: "So skarp can check later what you understood at that moment.",
  },
  answer_skipped: {
    provenance: "clicked",
    why_kept: "So the skip rate can be counted, and skarp can tell when an ask was refused.",
  },
  answer_not_yet: {
    provenance: "clicked",
    why_kept: "So skarp knows you weren't ready yet, and can ask again later.",
  },
  silence: {
    provenance: "observed",
    why_kept: "So you can see when skarp chose not to ask, and why.",
  },
  assistant_reply: {
    provenance: "reported",
    why_kept: "So you can see what the model said, kept apart from what you know.",
  },
  model_call: {
    provenance: "observed",
    why_kept: "So you can count model calls and tokens, and prove no call came before an answer.",
  },
  tool_call: {
    provenance: "observed",
    why_kept: "So you can see every file the AI read, searched or proposed to change (A13).",
  },
  referee: {
    provenance: "observed",
    why_kept:
      "So you can see which checks a reply or answer passed or failed, and what skarp did next.",
  },
  outcome: {
    provenance: "observed",
    why_kept:
      "So skarp can make asks lighter where you've shown understanding, and heavier after a miss.",
  },
  run: {
    provenance: "observed",
    why_kept:
      "So you can see every command skarp ran with your OK, what it returned, and what you put off.",
  },
  skarp: {
    provenance: "observed",
    why_kept:
      "So skarp-on chats can be compared with control chats, which only get the closing Return (D95).",
  },
  edit: {
    provenance: "clicked",
    why_kept: "So you can see which of the AI's changes you accepted, rejected or undid, and when.",
  },
  mode: {
    provenance: "clicked",
    why_kept:
      "So stops and resumes can be counted (D108), and nothing is owed for a stopped stretch.",
  },
  stop_everywhere: {
    provenance: "clicked",
    why_kept:
      "So stops can be counted (D108), and skarp knows after a restart that you stopped it.",
  },
  stop: {
    provenance: "clicked",
    why_kept: "So you can see when you stopped the AI mid-turn, and what it was doing.",
  },
  piece_left: {
    provenance: "observed",
    why_kept:
      "So a piece of an understand chat you didn't get to, or missed twice, waits on the Shelf (D121, D126).",
  },
  dismiss: {
    provenance: "clicked",
    why_kept: "So a Shelf item you removed stays removed, while what happened is still on record.",
  },
  error_rejected: {
    provenance: "observed",
    why_kept: "So you can see what skarp refused, and why.",
  },
  model_switch: {
    provenance: "reported",
    why_kept: "So you can see when the model you picked was not the one that ran, and why.",
  },
  ask_event: {
    provenance: "clicked",
    why_kept: 'So an undo, a skip\'s reason or a "lighter" on an ask is on record (N1).',
  },
  segment: {
    provenance: "observed",
    why_kept: "So you can see where a chat turned to new work, and what it was about (D49).",
  },
  error_model: {
    provenance: "reported",
    why_kept: "So you can find out later what went wrong with the model, and when.",
  },
};

export const SCHEMA_VERSION = 1;

// Wraps a payload in the ledger envelope. session_id is optional only for error_rejected;
// the conformance test checks that rule against the schema, since TypeScript can't.
export function toLedgerLine(
  clock: ClockPort,
  type: EventType,
  session_id: string | undefined,
  payload: object,
  refs: string[] = [],
): string {
  const event: LedgerEvent = {
    kind: "ledger_event",
    id: crypto.randomUUID(),
    time: clock.now().toISOString(),
    type,
    schema_version: SCHEMA_VERSION,
    ...(session_id === undefined ? {} : { session_id }),
    ...RULES[type],
    refs,
    payload,
  };
  return JSON.stringify(event);
}
