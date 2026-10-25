// Chat panel: header, start screen, sessions, messages, light lines,
// changes bar, message box, mode picker, strip, divider.
import { type ReactNode, useState } from "react";
import { Badge, cx, Dropdown, type DropdownOption, Icon, Mark, SpeakerIcon } from "./basics.tsx";

/* ---------- header, strip, divider ---------- */

function HeaderBtn({
  icon,
  label,
  onClick,
  showLabel,
}: {
  icon?: string;
  label: string;
  onClick?: () => void;
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex cursor-pointer items-center gap-1 text-small text-text-muted hover:text-text"
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {showLabel && label}
    </button>
  );
}

/** Back, title, New, Recall, Finish. The start screen passes no title/Finish. */
export function ChatHeader({
  title,
  onBack,
  onNew,
  onRecall,
  onFinish,
}: {
  title: string;
  onBack?: () => void;
  onNew?: () => void;
  onRecall?: () => void;
  onFinish?: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border px-3 py-2">
      {onBack && <HeaderBtn icon="arrow-left" label="Back to sessions" onClick={onBack} />}
      <b className="mr-auto truncate font-medium">{title}</b>
      {onNew && <HeaderBtn icon="add" label="New chat" onClick={onNew} />}
      {onRecall && <HeaderBtn icon="history" label="Recall" onClick={onRecall} showLabel />}
      {onFinish && <HeaderBtn label="Finish" onClick={onFinish} showLabel />}
    </header>
  );
}

/** "skarp off for this chat". */
export function Strip({
  children,
  action,
  onAction,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="status"
      className="flex justify-between border-b border-warning px-3 py-1.5 text-small text-warning"
    >
      <span>{children}</span>
      {action && (
        <button type="button" className="cursor-pointer text-accent" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

/** "new part of this chat" (piece 14). */
export function SegmentDivider({ children = "new part of this chat" }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-small text-text-muted before:flex-1 before:border-t before:border-border after:flex-1 after:border-t after:border-border">
      {children}
    </div>
  );
}

/* ---------- messages ---------- */

/** Consecutive items from one speaker under one icon; name only on the latest. */
export function SpeakerGroup({
  who,
  showName,
  children,
  srSummary,
  streaming,
}: {
  who: "skarp" | "assistant";
  showName?: boolean;
  children: ReactNode;
  /** polite screen-reader summary instead of word-by-word streaming */
  srSummary?: string;
  streaming?: boolean;
}) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2" aria-busy={streaming}>
      <SpeakerIcon who={who} />
      <div className="flex min-w-0 flex-col">
        {showName && (
          <span className="text-small font-medium leading-5 text-text-muted">
            {who === "skarp" ? "skarp" : "Assistant"}
          </span>
        )}
        {children}
        {srSummary && (
          <span className="sr-only" role="status">
            {srSummary}
          </span>
        )}
      </div>
    </div>
  );
}

/** Assistant prose. */
export const Message = ({
  showName,
  children,
  streaming,
  srSummary,
}: {
  showName?: boolean;
  children: ReactNode;
  streaming?: boolean;
  srSummary?: string;
}) => (
  <SpeakerGroup who="assistant" showName={showName} streaming={streaming} srSummary={srSummary}>
    <div>{children}</div>
  </SpeakerGroup>
);

/** Your message on the right, with skarp's faint guess under it. */
export function UserBubble({
  children,
  initial,
  reads,
  onFixReads,
}: {
  children: ReactNode;
  initial?: string;
  reads?: string;
  onFixReads?: () => void;
}) {
  return (
    <div className="flex items-start justify-end gap-2">
      <div className="flex max-w-[80%] flex-col items-end gap-0.5">
        <div className="rounded-[10px_10px_4px_10px] border border-match-edge bg-match px-2.5 py-1">
          {children}
        </div>
        {reads && (
          <button
            type="button"
            className="cursor-pointer text-small text-text-muted"
            title="Tap to correct"
            onClick={onFixReads}
          >
            skarp reads this as: {reads}
          </button>
        )}
      </div>
      <SpeakerIcon who="you" initial={initial} />
    </div>
  );
}

/** Live "what the assistant is doing" line, from observed tool calls only. */
export function ActivityLine({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-small text-text-muted">
      <Icon name="loading" className="codicon-modifier-spin" />
      {children}
    </div>
  );
}

/** A finished item as one light line; opens in place as label / value rows. */
export function LightLine({
  icon,
  children,
  result,
  rows,
  footer,
  defaultOpen,
}: {
  icon?: string;
  children: ReactNode;
  result?: ReactNode;
  rows?: [string, ReactNode][];
  footer?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const expandable = !!(rows || footer);
  return (
    <div>
      <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 leading-5 text-text-muted">
        <span className="leading-5">{icon && <Icon name={icon} />}</span>
        <span>
          {children} {result}{" "}
          {expandable && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? "Close details" : "Open details"}
              className="cursor-pointer text-text-muted"
              onClick={() => setOpen(!open)}
            >
              <Icon name={open ? "chevron-down" : "chevron-right"} />
            </button>
          )}
        </span>
      </div>
      {open && expandable && (
        <div className="my-1 flex flex-col gap-1 border-l-2 border-border py-2 pl-2.5">
          {rows?.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
              <span className="text-text-muted">{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {footer}
        </div>
      )}
    </div>
  );
}

/* ---------- changes bar ---------- */

export type ChangedFile = { path: string; add: number; del: number };
const diffStat = (a: number, d: number) =>
  `${a ? `+${a}` : ""}${a && d ? " " : ""}${d ? `−${d}` : ""}`;

/** Held edits: nothing is written until Accept. `accepted` shows the Undo accept form. */
export function ChangesBar({
  files,
  accepted,
  notice,
  defaultOpen,
  onAccept,
  onReject,
  onOpenDiff,
  onUndoAccept,
}: {
  files: ChangedFile[];
  accepted?: boolean;
  /** e.g. "1 test failed, a fix is coming" */
  notice?: string;
  defaultOpen?: boolean;
  /** no path = all */
  onAccept?: (path?: string) => void;
  onReject?: (path?: string) => void;
  onOpenDiff?: (path: string) => void;
  onUndoAccept?: () => void;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const add = files.reduce((n, f) => n + f.add, 0);
  const del = files.reduce((n, f) => n + f.del, 0);
  const n = files.length;
  const act = "cursor-pointer";
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border px-2 py-1.5 text-small">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Hide files" : "Show files"}
          className="cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} />
        </button>
        <b className="font-medium">
          {n} {n === 1 ? "file" : "files"} {accepted ? "accepted" : "changed"}
        </b>
        <span className="text-text-muted">{notice ?? diffStat(add, del)}</span>
        <span className="ml-auto flex gap-2.5">
          {accepted ? (
            <button type="button" className={cx(act, "text-accent")} onClick={onUndoAccept}>
              Undo accept
            </button>
          ) : (
            <>
              <button type="button" className={cx(act, "text-accent")} onClick={() => onAccept?.()}>
                Accept all
              </button>
              <button
                type="button"
                className={cx(act, "text-text-muted")}
                onClick={() => onReject?.()}
              >
                Reject all
              </button>
            </>
          )}
        </span>
      </div>
      {open &&
        files.map((f) => (
          <div key={f.path} className="flex items-center gap-2.5 py-0.5 pl-[18px] text-text-muted">
            <code className="mr-auto truncate text-text">{f.path}</code>
            <span>{diffStat(f.add, f.del)}</span>
            <button
              type="button"
              aria-label={`Open diff of ${f.path}`}
              title="Open diff in editor"
              className={act}
              onClick={() => onOpenDiff?.(f.path)}
            >
              <Icon name="diff" />
            </button>
            {!accepted && (
              <>
                <button
                  type="button"
                  className={cx(act, "text-accent")}
                  onClick={() => onAccept?.(f.path)}
                >
                  Accept
                </button>
                <button type="button" className={act} onClick={() => onReject?.(f.path)}>
                  Reject
                </button>
              </>
            )}
          </div>
        ))}
    </div>
  );
}

/* ---------- message box + mode picker ---------- */

export const MODES: DropdownOption[] = [
  { value: "quick", label: "Quick", hint: "skarp stays light; no long exercises" },
  { value: "time", label: "I have time", hint: "skarp may offer one deeper exercise" },
  {
    value: "off",
    label: "skarp off (this chat)",
    hint: "skarp stops asking here; the assistant keeps working",
  },
];

export function ModePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Dropdown label="Mode" up options={MODES} value={value} onChange={onChange} />;
}

/** Grows to ~8 lines then scrolls; Enter sends, Shift+Enter adds a line; Send becomes Stop while the
 *  assistant works. The mode picker sits below. */
export function MessageBox({
  value,
  onChange,
  onSend,
  onStop,
  working,
  mode,
  onMode,
  model,
  models,
  onModel,
  placeholder = "Message skarp…",
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  working?: boolean;
  /** omit both to hide the picker (modes aren't built yet) */
  mode?: string;
  onMode?: (v: string) => void;
  /** the model picker beside the mode picker; hidden until the host lists models */
  model?: string;
  models?: DropdownOption[];
  onModel?: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-1 rounded-card border border-border p-2 focus-within:border-accent focus-within:shadow-[0_0_0_1px_var(--skarp-accent)]">
        <textarea
          aria-label="Message"
          rows={1}
          value={value}
          placeholder={placeholder}
          className="max-h-[12em] min-h-5 flex-1 resize-none overflow-y-auto bg-transparent [field-sizing:content] placeholder:text-text-muted focus:outline-none"
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !working && value.trim()) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        {working ? (
          <button
            type="button"
            aria-label="Stop the assistant"
            title="Stop the assistant"
            className="cursor-pointer text-base"
            onClick={onStop}
          >
            <Icon name="debug-stop" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!value.trim()}
            className="cursor-pointer text-base text-accent disabled:cursor-default disabled:text-text-muted"
            onClick={onSend}
          >
            <Icon name="send" />
          </button>
        )}
      </div>
      {(onMode || (onModel && models?.length)) && (
        <div className="flex gap-1.5">
          {onMode && <ModePicker value={mode ?? "quick"} onChange={onMode} />}
          {onModel && models?.length ? (
            <Dropdown label="Model" up options={models} value={model ?? ""} onChange={onModel} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------- sessions + start screen ---------- */

export type Session = {
  id: string;
  title: string;
  status: "working" | "question" | "done" | "waiting";
  /** "3 files", "yesterday", "waiting on Charge retry" */
  detail?: string;
  pinned?: boolean;
  /** linked chat, one level under its parent */
  child?: boolean;
};

const statusText = { working: "working", question: "question waiting", done: "done", waiting: "" };

/** Title + status; hover shows pin / archive / delete. */
export function SessionRow({
  s,
  onOpen,
  onPin,
  onArchive,
  onDelete,
}: {
  s: Session;
  onOpen?: (id: string) => void;
  onPin?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  // only the actions the caller wires up are shown
  const tools = (
    [
      [s.pinned ? "Unpin" : "Pin", "pin", onPin],
      ["Archive", "archive", onArchive],
      ["Delete", "trash", onDelete],
    ] as const
  ).filter(([, , fn]) => fn);
  return (
    <div
      className={cx(
        "group flex items-center gap-2 rounded-control px-1.5 py-1 hover:bg-surface-raised",
        s.child && "pl-2.5",
      )}
    >
      {s.child && (
        <span
          aria-hidden="true"
          className="-mt-1.5 h-2.5 w-3 shrink-0 rounded-bl-md border-b border-l border-text-muted"
        />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        onClick={() => onOpen?.(s.id)}
      >
        {s.pinned && <Icon name="pinned" />}
        <span className="truncate">{s.title}</span>
      </button>
      <span className="hidden gap-2 text-text-muted group-focus-within:flex group-hover:flex">
        {tools.map(([label, icon, fn]) => (
          <button
            type="button"
            key={label}
            aria-label={`${label} ${s.title}`}
            title={label}
            className="cursor-pointer"
            onClick={() => fn?.(s.id)}
          >
            <Icon name={icon} />
          </button>
        ))}
      </span>
      {s.status === "question" ? (
        <Badge tone="accent">question waiting</Badge>
      ) : (
        <span className="shrink-0 text-small text-text-muted">
          {s.status === "working" && <Icon name="loading" className="codicon-modifier-spin" />}{" "}
          {[statusText[s.status], s.detail].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}

/** Pinned first, then newest first is the caller's order; this just renders it. */
export function SessionsList(props: {
  sessions: Session[];
  onOpen?: (id: string) => void;
  onNew?: () => void;
  onPin?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const { sessions, onNew, ...rows } = props;
  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <b className="mr-auto font-medium">Sessions</b>
        <HeaderBtn icon="add" label="New chat" onClick={onNew} showLabel />
      </header>
      <div className="flex flex-col gap-0.5 p-3">
        {sessions.map((s) => (
          <SessionRow key={s.id} s={s} {...rows} />
        ))}
      </div>
    </div>
  );
}

/** A new chat opens here. No sessions yet = just the mark, one line and the box. */
export function StartScreen({
  due,
  sessions = [],
  onOpenSession,
  onAllSessions,
  children,
}: {
  /** the Return card; absent when nothing is due */
  due?: ReactNode;
  sessions?: Session[];
  onOpenSession?: (id: string) => void;
  onAllSessions?: () => void;
  /** MessageBox */
  children: ReactNode;
}) {
  const empty = sessions.length === 0 && !due;
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 p-3">
        {empty ? (
          <div className="flex flex-col items-center gap-2.5 pt-12 pb-8 text-center">
            <Mark className="size-10" />
            <p className="m-0 text-question">What are we working on?</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Mark className="size-5" />
              <p className="m-0 text-question">What are we working on?</p>
            </div>
            {due}
            {sessions.length > 0 && <div className="text-small text-text-muted">Recent</div>}
            {sessions.map((s) => (
              <button
                type="button"
                key={s.id}
                className="flex cursor-pointer flex-col rounded-control border border-border px-2 py-1.5 text-left"
                onClick={() => onOpenSession?.(s.id)}
              >
                {s.title}
                <span className="text-small text-text-muted">
                  {[statusText[s.status], s.detail].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
            {sessions.length > 0 && (
              <button
                type="button"
                className="cursor-pointer self-start text-small text-accent"
                onClick={onAllSessions}
              >
                All sessions
              </button>
            )}
          </>
        )}
      </div>
      <div className="border-t border-border p-3">{children}</div>
    </div>
  );
}
