import type { Answer, EditDecision, InMessage, RunDecision, UserMessage } from "@skarp/schema";
import schema from "@skarp/schema/messages.schema.json" with { type: "json" };
import Ajv from "ajv";

const ajv = new Ajv();
ajv.addSchema(schema, "skarp");
const checkUserMessage = ajv.compile<UserMessage>({
  $ref: "skarp#/definitions/UserMessage",
});
const checkAnswer = ajv.compile<Answer>({ $ref: "skarp#/definitions/Answer" });
const checkRunDecision = ajv.compile<RunDecision>({ $ref: "skarp#/definitions/RunDecision" });
const checkEditDecision = ajv.compile<EditDecision>({ $ref: "skarp#/definitions/EditDecision" });

// raw comes from the webview and is untrusted. Returns a message built
// only from the schema's fields, or null.
export function ValidateAndParse(raw: unknown, session_id: string): InMessage | null {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind === "user_message") {
    // session_id comes from the extension, never from the webview
    const msg: unknown = { ...(raw as object), session_id };
    if (!checkUserMessage(msg)) return null;
    if (msg.text.trim() === "") return null;
    return { kind: msg.kind, session_id: msg.session_id, text: msg.text };
  }
  if (kind === "answer") {
    if (!checkAnswer(raw)) return null;
    // a typed answer needs text; a click (skipped / not_yet) carries none
    const typed = raw.response === "answered";
    if (typed !== (raw.value.trim() !== "")) return null;
    // a pointed-at line is a plain file:line, nothing else
    const evidence = typed && /^[\w./-]{1,300}:\d{1,6}$/.test(raw.evidence ?? "") && raw.evidence;
    return {
      kind: raw.kind,
      ask_id: raw.ask_id,
      nonce: raw.nonce,
      response: raw.response,
      value: raw.value,
      ...(typed && raw.sure && { sure: raw.sure }),
      ...(evidence && { evidence }),
    };
  }
  if (kind === "ask_event") {
    const { ask_id, event, value } = raw as { ask_id?: unknown; event?: unknown; value?: unknown };
    if (typeof ask_id !== "string" || !["undo", "skip_reason", "lighter"].includes(String(event)))
      return null;
    if (value !== undefined && (typeof value !== "string" || value.length > 100)) return null;
    return {
      kind,
      session_id,
      ask_id,
      event: event as "undo" | "skip_reason" | "lighter",
      ...(value !== undefined && { value }),
    };
  }
  if (kind === "recall") return { kind, session_id };
  if (kind === "edit_decision") {
    const msg: unknown = { ...(raw as object), session_id };
    if (!checkEditDecision(msg)) return null;
    return {
      kind: msg.kind,
      session_id: msg.session_id,
      action: msg.action,
      ...(msg.path !== undefined && { path: msg.path }),
    };
  }
  if (kind === "finish") return { kind: "finish", session_id };
  if (kind === "stop") return { kind: "stop", session_id };
  if (kind === "set_mode") {
    const mode = (raw as { mode?: unknown }).mode;
    if (mode !== "quick" && mode !== "time" && mode !== "off") return null;
    return { kind: "set_mode", session_id, mode };
  }
  if (kind === "list_sessions") return { kind: "list_sessions" };
  if (kind === "get_area") return { kind: "get_area" };
  if (kind === "get_data") return { kind: "get_data" };
  if (kind === "delete_all") return { kind: "delete_all" };
  if (kind === "dismiss") {
    const ref = (raw as { ref?: unknown }).ref;
    return typeof ref === "string" ? { kind, ref } : null;
  }
  if (kind === "stop_everywhere") {
    const stopped = (raw as { stopped?: unknown }).stopped;
    return typeof stopped === "boolean" ? { kind, stopped } : null;
  }
  if (kind === "open_session" || kind === "delete_session") {
    // switching to a saved chat is allowed; the id must be a plain name (FileSessions checks too)
    const id = (raw as { session_id?: unknown }).session_id;
    if (typeof id !== "string" || !/^[\w-]{1,100}$/.test(id)) return null;
    return { kind, session_id: id };
  }
  if (kind === "run_decision") {
    if (!checkRunDecision(raw)) return null;
    return { kind: raw.kind, run_id: raw.run_id, nonce: raw.nonce, approve: raw.approve };
  }
  return null;
}
