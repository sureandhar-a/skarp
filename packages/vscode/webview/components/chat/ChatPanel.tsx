import type {
  Answer,
  Ask,
  AssistantReply,
  HeldEdits,
  Notice,
  OutMessage,
  RunApproval,
  RunResult,
  Sessions,
  SessionView,
  UserMessage,
} from "@skarp/schema";
import {
  ActivityLine,
  AskCard,
  Button,
  Card,
  ChangesBar,
  ChatHeader,
  Choice,
  Confidence,
  INTENTS,
  type Intent,
  LightLine,
  LinePicker,
  Markdown,
  Message,
  MessageBox,
  OrderAnswer,
  SegmentDivider,
  type Session,
  SessionsList,
  SkipReasons,
  SpeakerGroup,
  StartScreen,
  Strip,
  TextAnswer,
  UndoLine,
  UserBubble,
} from "@skarp/ui";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { vscode } from "../../vscode";

type Item =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; reply: AssistantReply }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "stopped" }
  | { id: string; kind: "notice"; notice: Notice }
  | {
      id: string;
      kind: "ask";
      ask: Ask;
      response?: Answer["response"];
      value?: string;
      sure?: Answer["sure"];
    }
  | { id: string; kind: "run"; run: RunApproval; approved?: boolean; result?: RunResult };

type Mode = SessionView["mode"];

const newId = () => crypto.randomUUID();

// the Referee's failed checks, in words
const CHECKS: Record<string, string> = {
  praise: "it praised",
  no_report: "no report of what it checked",
  no_least_sure: "it didn't say what it's least sure of",
  vague_least_sure: "its doubt names nothing specific",
  claim_not_observed: "it cites files it didn't read",
  unbacked_action: "it says it did something skarp didn't see",
  no_edit: "it described a fix without proposing it",
};

const RESPONSE_TEXT: Record<Answer["response"], string> = {
  answered: "answered",
  skipped: "skipped",
  not_yet: "not yet",
};

// One step of the chat on screen. Live messages and a saved transcript both go through here.
function apply(items: Item[], m: SessionView["items"][number] | UserMessage): Item[] {
  const id = newId();
  switch (m.kind) {
    case "user_message":
      return [...items, { id, kind: "user", text: m.text }];
    case "answer":
      return items.map((i) =>
        i.kind === "ask" && i.ask.ask_id === m.ask_id
          ? { ...i, response: m.response, value: m.value, ...(m.sure && { sure: m.sure }) }
          : i,
      );
    case "assistant_reply":
      return [...items, { id, kind: "assistant", reply: m }];
    case "error":
      return [...items, { id, kind: "error", text: m.message }];
    case "stop":
      return [...items, { id, kind: "stopped" }];
    case "notice":
      return [...items, { id, kind: "notice", notice: m }];
    case "ask":
      return [...items, { id, kind: "ask", ask: m }];
    case "run_approval":
      return [...items, { id, kind: "run", run: m }];
    case "run_decision":
      return items.map((i) =>
        i.kind === "run" && i.run.run_id === m.run_id ? { ...i, approved: m.approve } : i,
      );
    case "run_result": {
      // the result belongs to the latest approved run still waiting for one
      const at = items.findLastIndex((i) => i.kind === "run" && i.approved && !i.result);
      return items.map((i, n) => (n === at && i.kind === "run" ? { ...i, result: m } : i));
    }
  }
}

// "8 hrs ago", like Copilot's sessions list
function ago(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!(min >= 1)) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)} hrs ago`;
  return `${Math.round(min / 60 / 24)} days ago`;
}

const toKit = (s: Sessions["items"][number]): Session => ({
  id: s.id,
  title: s.title || "New chat",
  status: s.status,
  detail: s.files ? `${s.files} ${s.files === 1 ? "file" : "files"} changed` : ago(s.updated),
});

const NO_HELD: HeldEdits = { kind: "held_edits", files: [], accepted: [] };

export const ChatPanel: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [chat, setChat] = useState({ id: "", title: "" });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [mode, setMode] = useState<Mode>("quick");
  const [control, setControl] = useState(false); // a control chat, shown as a quiet strip
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState("");
  // waiting for the core: shown as an activity line, cleared by the next reply, ask or error
  const [working, setWorking] = useState(false);
  // the open card's How sure, pointed-at line and order; one card is open at a time
  const [sure, setSure] = useState<Answer["sure"]>();
  const [pointed, setPointed] = useState("");
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  // a tap waits 3 s with Undo before it's sent, so nothing is revealed before then
  const [tap, setTap] = useState<{ ask: Ask; value: string } | null>(null);
  const [more, setMore] = useState<string[]>([]); // asks showing their block under "more"
  const [reasoned, setReasoned] = useState<string[]>([]); // skips that got a reason
  // held edits wait above the message box until Accept
  const [held, setHeld] = useState<HeldEdits>(NO_HELD);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // the extension already checked these; unknown kinds are ignored
      const message = event.data as OutMessage;
      if (message.kind === "sessions") return setSessions(message.items.map(toKit));
      if (message.kind === "held_edits") return setHeld(message);
      if (message.kind === "area" || message.kind === "data") return; // the skarp area's business
      if (message.kind === "chat_state") return setControl(message.control);
      // UI-only, from the extension: the models this machine can use
      const raw = event.data as { kind?: string; items?: typeof models; current?: string };
      if (raw.kind === "idle") return setWorking(false); // the extension finished this request
      if (raw.kind === "models") {
        setModels(raw.items ?? []);
        return setModel(raw.current ?? "");
      }
      if (message.kind === "session_view") {
        setChat({ id: message.session_id, title: message.title });
        setMode(message.mode);
        setControl(false); // a chat_state follows when this chat is a control chat
        setItems(message.items.reduce(apply, []));
        setHeld(NO_HELD); // a held_edits message follows when this chat has any
        setShowSessions(false);
        setWorking(false);
        return;
      }
      setItems((list) => apply(list, message));
      setWorking(false);
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ kind: "ready" }); // the extension answers with the last chat
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the list or activity changes
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, working]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setItems((list) => apply(list, { kind: "user_message", session_id: chat.id, text }));
    setChat((c) => (c.title ? c : { ...c, title: text.slice(0, 60) }));
    setInput("");
    setWorking(true);
    vscode.postMessage({ kind: "user_message", text });
  };

  const answer = (ask: Ask, response: Answer["response"], value = "") => {
    const typed = response === "answered";
    const m = {
      kind: "answer",
      ask_id: ask.ask_id,
      nonce: ask.nonce,
      response,
      value,
      ...(typed && sure && { sure }),
      ...(typed && pointed && { evidence: pointed }),
    } as const;
    vscode.postMessage(m);
    setItems((list) => apply(list, m));
    setDraft("");
    setSure(undefined);
    setPointed("");
    setWorking(true);
  };
  // a small signal on an ask, logged by the core: undo, a skip's reason, lighter
  const askEvent = (ask: Ask, event: "undo" | "skip_reason" | "lighter", value?: string) =>
    vscode.postMessage({ kind: "ask_event", ask_id: ask.ask_id, event, ...(value && { value }) });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tap carries what to send
  const sendTap = useCallback(() => {
    if (tap) answer(tap.ask, "answered", tap.value);
    setTap(null);
  }, [tap]);

  // nothing runs without this click; "Not now" shows nothing more in the chat
  const decideRun = (run: RunApproval, approve: boolean) => {
    const m = { kind: "run_decision", run_id: run.run_id, nonce: run.nonce, approve } as const;
    vscode.postMessage(m);
    setItems((list) => apply(list, m));
    setWorking(true);
  };
  // stops everything in flight for this chat; the box is ready for the next message
  const stop = () => {
    const m = { kind: "stop", session_id: chat.id } as const;
    vscode.postMessage(m);
    setItems((list) => apply(list, m));
    setWorking(false);
    setHeld((h) => ({ ...h, accepted: [] })); // the last Accept's bar goes with the stopped turn
  };
  const changeMode = (next: string) => {
    setMode(next as Mode);
    vscode.postMessage({ kind: "set_mode", mode: next });
  };

  // an Accept goes on to offer the tests, so it works like a message
  const decideEdits = (action: "accept" | "reject" | "undo_accept", path?: string) => {
    vscode.postMessage({ kind: "edit_decision", action, ...(path && { path }) });
    setWorking(true);
  };
  const openSessions = () => {
    vscode.postMessage({ kind: "list_sessions" });
    setShowSessions(true);
  };
  const newChat = () => vscode.postMessage({ kind: "new_chat" });
  const open = (session_id: string) => vscode.postMessage({ kind: "open_session", session_id });

  const box = (
    <MessageBox
      value={input}
      onChange={setInput}
      onSend={send}
      onStop={stop}
      working={working}
      mode={mode}
      onMode={changeMode}
      models={models}
      model={model}
      onModel={(value) => {
        setModel(value);
        vscode.postMessage({ kind: "set_chat_model", value });
      }}
    />
  );
  // you never forget skarp is off for this chat
  const strip =
    mode === "off" ? (
      <Strip action="Turn on" onAction={() => changeMode("quick")}>
        skarp off for this chat
      </Strip>
    ) : (
      control && (
        <Strip>
          skarp stays quiet in this chat, to measure whether it helps. Finish still asks one closing
          question.
        </Strip>
      )
    );
  const pending = held.files.length > 0;

  // the sessions list, newest first; the header's back arrow opens it
  if (showSessions) {
    return (
      <div className="flex h-screen flex-col bg-surface text-text">
        <SessionsList
          sessions={sessions}
          onOpen={open}
          onNew={newChat}
          onDelete={(session_id) => vscode.postMessage({ kind: "delete_session", session_id })}
        />
      </div>
    );
  }

  // a new chat starts here, with recent chats to pick up
  if (items.length === 0) {
    const recent = sessions.filter((s) => s.id !== chat.id).slice(0, 3);
    return (
      <div className="flex h-screen flex-col bg-surface text-text">
        <ChatHeader title="New chat" onBack={sessions.length ? openSessions : undefined} />
        <div className="mt-auto">
          <StartScreen sessions={recent} onOpenSession={open} onAllSessions={openSessions}>
            {box}
          </StartScreen>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-surface text-text">
      <ChatHeader
        title={chat.title || "New chat"}
        onBack={openSessions}
        onNew={newChat}
        onRecall={() => {
          vscode.postMessage({ kind: "recall" });
          setWorking(true);
        }}
        onFinish={() => {
          vscode.postMessage({ kind: "finish" });
          setWorking(true);
        }}
      />
      {strip}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {items.map((item, i) => {
          // speaker name only on the first of a run from the same speaker
          const firstOfRun = items[i - 1]?.kind !== item.kind;
          if (item.kind === "user") {
            return <UserBubble key={item.id}>{item.text}</UserBubble>;
          }
          if (item.kind === "assistant") {
            return (
              <Message key={item.id} showName={firstOfRun}>
                <Markdown>{item.reply.text}</Markdown>
                {/* what the AI is least sure of; checks it still failed after the retry */}
                {item.reply.least_sure && (
                  <div className="text-small text-text-muted">
                    Least sure: {item.reply.least_sure}
                  </div>
                )}
                {item.reply.failed_checks?.length ? (
                  <div className="text-small text-warning">
                    skarp's checks on this reply failed:{" "}
                    {item.reply.failed_checks.map((f) => CHECKS[f] ?? f).join("; ")}
                  </div>
                ) : null}
              </Message>
            );
          }
          if (item.kind === "stopped") {
            return (
              <LightLine key={item.id} icon="debug-stop">
                You stopped this.
              </LightLine>
            );
          }
          if (item.kind === "notice") {
            const { about, text, pass } = item.notice;
            // a new part of the chat is a divider; everything else is a light line
            if (about === "segment") return <SegmentDivider key={item.id}>{text}</SegmentDivider>;
            const icon =
              about === "verdict"
                ? pass
                  ? "pass"
                  : "circle-large-outline"
                : about === "finish"
                  ? "check-all"
                  : "info";
            return (
              <LightLine key={item.id} icon={icon}>
                {text}
              </LightLine>
            );
          }
          if (item.kind === "error") {
            return (
              <div
                key={item.id}
                role="alert"
                className="rounded-card border border-danger px-3 py-2 text-danger"
              >
                {item.text}
              </div>
            );
          }
          if (item.kind === "run") {
            const { run, approved, result } = item;
            if (approved === false) return null; // owed as "not run", shown on the Shelf
            if (approved === undefined) {
              return (
                <Card
                  key={item.id}
                  pinned
                  title="Run this command?"
                  actions={
                    <>
                      <Button onClick={() => decideRun(run, true)}>Run</Button>
                      <Button variant="quiet" onClick={() => decideRun(run, false)}>
                        Not now
                      </Button>
                    </>
                  }
                >
                  <code className="break-all">{run.command}</code>
                </Card>
              );
            }
            return (
              <LightLine
                key={item.id}
                icon={!result ? "loading" : result.exit_code === 0 ? "pass" : "error"}
                result={result ? `exit ${result.exit_code}` : "running…"}
                rows={
                  result ? [["Output", <pre key="o">{result.output.slice(-2000)}</pre>]] : undefined
                }
              >
                Ran <code>{run.command}</code>
              </LightLine>
            );
          }
          const { ask } = item;
          // a check followed at once by "Next piece?" shares its card
          const nextAsk = items[i + 1];
          const merged =
            nextAsk?.kind === "ask" && !nextAsk.response && nextAsk.ask.block_id === "O2";
          if (item.response && merged) return null;
          const before = items[i - 1];
          const answeredBefore =
            ask.block_id === "O2" && !item.response && before?.kind === "ask" && before.response
              ? before
              : undefined;
          // limit: unknown intent falls back to "explain"; the kernel's intent list should match the kit's
          const intent: Intent = ask.intent in INTENTS ? (ask.intent as Intent) : "explain";
          // a handled ask collapses to one light line
          const handled = (it: Extract<Item, { kind: "ask" }>) =>
            it.response && (
              <>
                <LightLine
                  icon={it.response === "answered" ? "check" : "debug-step-over"}
                  result={RESPONSE_TEXT[it.response]}
                  rows={[
                    ...(it.value ? [["You said", it.value] as [string, string]] : []),
                    ...(it.sure ? [["How sure", it.sure] as [string, string]] : []),
                  ]}
                >
                  {it.ask.question_text}
                </LightLine>
                {/* Skip sent at once; a reason is optional, offered on the latest skip */}
                {it.response === "skipped" &&
                  i === items.length - 1 &&
                  !reasoned.includes(it.ask.ask_id) && (
                    <SkipReasons
                      onReason={(r) => {
                        askEvent(it.ask, "skip_reason", r);
                        setReasoned((list) => [...list, it.ask.ask_id]);
                      }}
                    />
                  )}
              </>
            );
          return (
            <SpeakerGroup key={item.id} who="skarp" showName>
              {item.response ? (
                handled(item)
              ) : (
                <AskCard
                  pinned
                  intent={intent}
                  question={ask.question_text}
                  why={ask.reason}
                  // "more" shows which block this is; "lighter" makes this chat's asks taps
                  fallbackNote={
                    more.includes(ask.ask_id) ? `Block ${ask.block_id} · ${intent}` : undefined
                  }
                  onMore={() =>
                    setMore((list) =>
                      list.includes(ask.ask_id)
                        ? list.filter((a) => a !== ask.ask_id)
                        : [...list, ask.ask_id],
                    )
                  }
                  onLighter={intent === "orient" ? undefined : () => askEvent(ask, "lighter")}
                  // orient has its own ways out: Big picture first, Done for now
                  hideActions={intent === "orient"}
                  lead={answeredBefore && handled(answeredBefore)}
                  onNotYet={() => answer(ask, "not_yet")}
                  onSkip={() => answer(ask, "skipped")}
                >
                  {/* only on blocks that ask for it */}
                  {ask.how_sure &&
                    (sure ? (
                      <span className="text-small text-text-muted">How sure: {sure}</span>
                    ) : (
                      <Confidence onPick={setSure} />
                    ))}
                  {tap?.ask.ask_id === ask.ask_id ? (
                    <UndoLine
                      onUndo={() => {
                        askEvent(ask, "undo");
                        setTap(null);
                      }}
                      onExpire={sendTap}
                    />
                  ) : ask.answer_type === "order" && ask.choices ? (
                    <OrderAnswer
                      items={orders[ask.ask_id] ?? ask.choices}
                      onChange={(list) => setOrders((o) => ({ ...o, [ask.ask_id]: list }))}
                      onSend={() =>
                        answer(
                          ask,
                          "answered",
                          (orders[ask.ask_id] ?? ask.choices ?? []).join(" → "),
                        )
                      }
                    />
                  ) : ask.answer_type === "choice" && ask.choices ? (
                    // a tap sends after a 3-second Undo; picking where to go sends at once
                    <Choice
                      options={ask.choices}
                      onPick={(i) => {
                        const value = ask.choices?.[i] ?? "";
                        if (intent === "orient") answer(ask, "answered", value);
                        else setTap({ ask, value });
                      }}
                    />
                  ) : (
                    <TextAnswer
                      value={draft}
                      onChange={setDraft}
                      onSend={() => draft.trim() && answer(ask, "answered", draft.trim())}
                      evidence={
                        ask.evidence?.length ? (
                          <LinePicker
                            options={ask.evidence}
                            value={pointed}
                            onChange={setPointed}
                          />
                        ) : undefined
                      }
                    />
                  )}
                </AskCard>
              )}
            </SpeakerGroup>
          );
        })}
        {working && <ActivityLine>Working…</ActivityLine>}
        <div ref={endRef} />
      </div>
      <div className="flex flex-col gap-2 border-t border-border p-3">
        {(pending || held.accepted.length > 0) && (
          <ChangesBar
            files={pending ? held.files : held.accepted}
            accepted={!pending}
            onAccept={(path) => decideEdits("accept", path)}
            onReject={(path) => decideEdits("reject", path)}
            onUndoAccept={() => decideEdits("undo_accept")}
            onOpenDiff={(path) => vscode.postMessage({ kind: "open_diff", path })}
          />
        )}
        {box}
      </div>
    </div>
  );
};
