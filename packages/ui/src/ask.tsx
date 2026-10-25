// Card shell and the AskCard with its five answer bodies.
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import {
  Chip,
  cx,
  EvidenceLink,
  Icon,
  type Intent,
  IntentLabel,
  KeyHint,
  TextField,
} from "./basics.tsx";

/** Card shell: title, body, actions. Only the card that needs you now gets `pinned`. */
export function Card({
  title,
  children,
  actions,
  pinned,
  className,
}: {
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  pinned?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "flex flex-col gap-2 rounded-card border bg-surface-raised px-3 py-2.5",
        pinned ? "border-accent" : "border-border",
        className,
      )}
    >
      {title && <b className="font-medium">{title}</b>}
      {children}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

/** The "Why this", "lighter" and "more" line. */
export function WhyLine({
  children,
  onLighter,
  onMore,
}: {
  children: ReactNode;
  onLighter?: () => void;
  onMore?: () => void;
}) {
  const link = "cursor-pointer text-accent";
  return (
    <div className="border-t border-border pt-1.5 text-small text-text-muted">
      Why this: {children}{" "}
      {onLighter && (
        <button type="button" className={link} onClick={onLighter}>
          lighter
        </button>
      )}
      {onLighter && onMore && " · "}
      {onMore && (
        <button type="button" className={link} onClick={onMore}>
          more
        </button>
      )}
    </div>
  );
}

/** Not yet (N) and Skip. Skip sends at once; reasons come after. */
export function NotYetSkip({ onNotYet, onSkip }: { onNotYet?: () => void; onSkip?: () => void }) {
  const b = "cursor-pointer text-small text-text-muted hover:text-text";
  return (
    <div className="ml-auto flex gap-3">
      <button type="button" className={b} onClick={onNotYet}>
        Not yet <KeyHint>N</KeyHint>
      </button>
      <button type="button" className={b} onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}

/** After Skip: optional reason chips. Ignored = "no reason given". */
export function SkipReasons({
  reasons = ["already know", "no time", "unclear question"],
  onReason,
}: {
  reasons?: string[];
  onReason?: (r: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-text-muted">Skipped.</span>
      {reasons.map((r) => (
        <Chip key={r} onClick={() => onReason?.(r)}>
          {r}
        </Chip>
      ))}
    </div>
  );
}

/** "Sent. Undo answer" for 3 seconds after a tap. The host reveals nothing until onExpire. */
export function UndoLine({
  seconds = 3,
  onUndo,
  onExpire,
}: {
  seconds?: number;
  onUndo: () => void;
  onExpire?: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onExpire?.(), seconds * 1000);
    return () => clearTimeout(t);
  }, [seconds, onExpire]);
  return (
    <div className="flex items-center gap-2 text-small text-text-muted">
      Sent.
      {/* not just "Undo": the changes bar has "Undo accept" next to it */}
      <button type="button" className="cursor-pointer text-accent" onClick={onUndo}>
        Undo answer
      </button>
    </div>
  );
}

/** One question per card. Pass an answer body as children; keys only fire inside the card. */
export function AskCard({
  intent,
  intentNote,
  question,
  children,
  pinned,
  fallbackNote,
  why,
  onNotYet,
  onSkip,
  onLighter,
  onMore,
  hideActions,
  lead,
}: {
  /** shown first in the card, e.g. the check just answered above "Next piece?" */
  lead?: ReactNode;
  intent: Intent;
  /** e.g. "offer" */
  intentNote?: string;
  question: ReactNode;
  children?: ReactNode;
  pinned?: boolean;
  /** which fallback rung ran */
  fallbackNote?: string;
  why?: ReactNode;
  onNotYet?: () => void;
  onSkip?: () => void;
  onLighter?: () => void;
  onMore?: () => void;
  hideActions?: boolean;
}) {
  return (
    <Card pinned={pinned}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: card-scoped shortcut */}
      <div
        className="flex flex-col gap-2"
        onKeyDown={(e) => {
          if (!isTyping(e) && e.key.toLowerCase() === "n") onNotYet?.();
        }}
      >
        {lead}
        <IntentLabel intent={intent} note={intentNote} />
        <p className="m-0 text-question font-medium">{question}</p>
        {fallbackNote && <div className="text-small text-text-muted">{fallbackNote}</div>}
        {children}
        {!hideActions && (
          <div className="flex">
            <NotYetSkip onNotYet={onNotYet} onSkip={onSkip} />
          </div>
        )}
        {why && (
          <WhyLine onLighter={onLighter} onMore={onMore}>
            {why}
          </WhyLine>
        )}
      </div>
    </Card>
  );
}

/* ---------- answer bodies ---------- */

/** Choice: 1-9 or a tap sends at once. */
export function Choice({
  options,
  onPick,
}: {
  options: ReactNode[];
  onPick: (index: number) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Choices"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keys 1-9 only work while the card has focus
      tabIndex={0}
      className="flex flex-col gap-1.5"
      onKeyDown={(e) => {
        const n = Number(e.key);
        if (!isTyping(e) && n >= 1 && n <= Math.min(9, options.length)) onPick(n - 1);
      }}
    >
      {options.map((o, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: options are positional (1-9)
          key={i}
          type="button"
          className="flex cursor-pointer items-center gap-2 rounded-control border border-border px-2 py-1.5 text-left hover:border-accent"
          onClick={() => onPick(i)}
        >
          <KeyHint>{i + 1}</KeyHint>
          {o}
        </button>
      ))}
    </div>
  );
}

/** Text answer with evidence (shortlist, editor click, or typed file:line). */
export function TextAnswer({
  value,
  onChange,
  onSend,
  evidence,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  evidence?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <TextField
        label="Your answer"
        multiline
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      {evidence}
      <span className="text-small text-text-muted">
        <KeyHint>Enter</KeyHint> sends
      </span>
    </div>
  );
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [it] = next.splice(from, 1);
  if (it !== undefined) next.splice(to, 0, it);
  return next;
}

/** Order: drag, or Alt+arrows. */
export function OrderAnswer({
  items,
  onChange,
  onSend,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  onSend: () => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [focused, setFocused] = useState(0);
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((it, i) => (
          <li
            key={it}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drag !== null && onChange(moveItem(items, drag, i))}
          >
            <button
              type="button"
              className="flex w-full cursor-grab items-center gap-2 rounded-control border border-border px-2 py-1.5 text-left"
              aria-label={`${it}, position ${i + 1} of ${items.length}. Alt plus arrows to move.`}
              onFocus={() => setFocused(i)}
              onKeyDown={(e) => {
                if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                e.preventDefault();
                const to = i + (e.key === "ArrowUp" ? -1 : 1);
                onChange(moveItem(items, i, to));
                // keep focus on the moved row
                requestAnimationFrame(() =>
                  e.currentTarget.closest("ul")?.querySelectorAll("button")[to]?.focus(),
                );
              }}
            >
              <Icon name="gripper" />
              {it}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 text-small text-text-muted">
        <span>
          <KeyHint>Alt</KeyHint>+arrows to move · row {focused + 1}
        </span>
        <button type="button" className="ml-auto cursor-pointer text-accent" onClick={onSend}>
          Send order
        </button>
      </div>
    </div>
  );
}

export type Line = { file: string; line: number };

/** LinePicker, shared by "mark a line" and evidence: shortlist, editor click, or type. */
export function LinePicker({
  options,
  value,
  onChange,
  onPickInEditor,
}: {
  options: Line[];
  value: string;
  onChange: (v: string) => void;
  onPickInEditor?: () => void;
}) {
  const refs = options.map((o) => `${o.file}:${o.line}`);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-small text-text-muted">
        Pick:
        {refs.map((r) => (
          <Chip key={r} selected={r === value} onClick={() => onChange(r)}>
            <code>{r}</code>
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <TextField
          label="file:line"
          placeholder="or type file:line"
          value={value}
          suggestions={refs}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        {onPickInEditor && (
          <button
            type="button"
            className="shrink-0 cursor-pointer text-small text-accent"
            onClick={onPickInEditor}
          >
            Click a line
          </button>
        )}
      </div>
    </div>
  );
}

/** "How sure?" only where the block asks for it. s / m / g. */
export function Confidence({ onPick }: { onPick: (c: "sure" | "maybe" | "guess") => void }) {
  const opts = [
    ["s", "sure"],
    ["m", "maybe"],
    ["g", "guess"],
  ] as const;
  return (
    <div
      role="toolbar"
      aria-label="How sure are you?"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: s/m/g only work while the card has focus
      tabIndex={0}
      className="flex flex-wrap gap-2"
      onKeyDown={(e) => {
        const hit = opts.find(([k]) => k === e.key.toLowerCase());
        if (hit && !isTyping(e)) onPick(hit[1]);
      }}
    >
      {opts.map(([k, w]) => (
        <button
          key={k}
          type="button"
          className="flex cursor-pointer items-center gap-2 rounded-control border border-border px-2 py-1.5 hover:border-accent"
          onClick={() => onPick(w)}
        >
          <KeyHint>{k}</KeyHint>
          {w}
        </button>
      ))}
    </div>
  );
}

export { EvidenceLink };
