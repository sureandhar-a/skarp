// Foundations: icons, Chip, Badge, KeyHint, EvidenceLink, IntentLabel, SpeakerIcon,
// BalanceStatus, TextField, Dropdown, Tabs, Confirm.
import {
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- icons ---------- */

export function Icon({ name, className }: { name: string; className?: string }) {
  return <i className={cx("codicon", `codicon-${name}`, className)} aria-hidden="true" />;
}

/** The brand balance. `tipped` = "not in balance yet". Single colour (currentColor). */
export function Mark({ tipped, className }: { tipped?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cx("size-4 shrink-0", className)}
    >
      {tipped ? (
        <>
          <g transform="rotate(-14 12 6.3)">
            <rect x="2.5" y="5.3" width="19" height="2" rx="1" />
          </g>
          <circle cx="12" cy="3.6" r="1.6" />
          <rect x="11" y="5" width="2" height="13" />
          <path d="M7 21.5h10l-1.4-3H8.4z" />
          <rect x="4.9" y="8.2" width="1.2" height="5" />
          <rect x="17.9" y="4.6" width="1.2" height="4" />
          <path d="M2 13.2h7a3.5 3.5 0 0 1-7 0z" />
          <path d="M15 8.6h7a3.5 3.5 0 0 1-7 0z" />
        </>
      ) : (
        <>
          <circle cx="12" cy="3.6" r="1.6" />
          <rect x="11" y="5" width="2" height="13" />
          <path d="M7 21.5h10l-1.4-3H8.4z" />
          <rect x="2.5" y="5.5" width="19" height="2" rx="1" />
          <rect x="4.9" y="7" width="1.2" height="5" />
          <rect x="17.9" y="7" width="1.2" height="5" />
          <path d="M2 12h7a3.5 3.5 0 0 1-7 0z" />
          <path d="M15 12h7a3.5 3.5 0 0 1-7 0z" />
        </>
      )}
    </svg>
  );
}

/* ---------- small marks ---------- */

export function Chip({
  children,
  onClick,
  selected,
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  const cls = cx(
    "inline-flex items-center gap-1 rounded-pill border px-2 text-small",
    selected ? "border-accent text-accent" : "border-border text-text",
  );
  return onClick ? (
    <button type="button" className={cx(cls, "cursor-pointer")} onClick={onClick}>
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

const badgeTone = {
  warning: "border-warning text-warning rounded-control",
  accent: "border-accent text-accent rounded-control",
  count: "border-border text-text-muted rounded-pill",
} as const;

/** Badge ("stale", "question waiting") and Count (Shelf tab, "1 on shelf"). */
export function Badge({
  tone = "warning",
  children,
}: {
  tone?: keyof typeof badgeTone;
  children: ReactNode;
}) {
  return (
    <span className={cx("inline-block border px-1.5 text-small leading-4", badgeTone[tone])}>
      {children}
    </span>
  );
}

export const Count = ({ children }: { children: ReactNode }) => (
  <Badge tone="count">{children}</Badge>
);

/** Shortcut hint: small, never louder than the label. */
export function KeyHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-control border border-border px-1 font-ui text-small text-text-muted">
      {children}
    </kbd>
  );
}

/** `file:line` link. Click opens the file and highlights the line. */
export function EvidenceLink({
  file,
  line,
  onOpen,
}: {
  file: string;
  line?: number;
  onOpen?: (file: string, line?: number) => void;
}) {
  const ref = line ? `${file}:${line}` : file;
  return (
    <button
      type="button"
      className="cursor-pointer text-accent underline-offset-2 hover:underline"
      onClick={() => onOpen?.(file, line)}
    >
      <code>{ref}</code>
    </button>
  );
}

/* ---------- intent + speaker + balance ---------- */

export const INTENTS = {
  commit: { icon: "edit", label: "Commit" },
  orient: { icon: "compass", label: "Orient" },
  hear: { icon: "eye", label: "Hear" },
  fly: { icon: "rocket", label: "Fly" },
  explain: { icon: "comment", label: "Explain" },
  challenge: { icon: "question", label: "Challenge" },
  check: { icon: "beaker", label: "Check" },
  return: { icon: "history", label: "Return" },
} as const;
export type Intent = keyof typeof INTENTS;

/** Icon + word, neutral colour. */
export function IntentLabel({ intent, note }: { intent: Intent; note?: string }) {
  const { icon, label } = INTENTS[intent];
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-text-muted">
      <Icon name={icon} />
      {label}
      {note && <span> · {note}</span>}
    </span>
  );
}

/** One 20px column, 16px glyph, no border. */
export function SpeakerIcon({
  who,
  initial = "Y",
}: {
  who: "skarp" | "assistant" | "you";
  initial?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex size-5 shrink-0 items-center justify-center text-small font-medium text-text-muted",
        who === "you" && "rounded-full bg-match text-text",
      )}
      title={who === "you" ? "You" : who === "skarp" ? "skarp" : "Assistant"}
    >
      {who === "skarp" && <Mark />}
      {who === "assistant" && <Icon name="package" className="text-[16px]" />}
      {who === "you" && initial.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** "Your answer vs the evidence" as skarp's balance. Never says "correct". */
export function BalanceStatus({ level }: { level: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap",
        level ? "text-accent" : "text-warning",
      )}
    >
      <Mark tipped={!level} />
      {level ? "in balance" : "not in balance yet"}
    </span>
  );
}

/* ---------- inputs ---------- */

type FieldProps = {
  label: string;
  multiline?: boolean;
  /** autocomplete values, e.g. file:line */
  suggestions?: string[];
} & Omit<InputHTMLAttributes<HTMLInputElement>, "list">;

const fieldCls =
  "w-full rounded-control border border-border bg-transparent px-2 py-1.5 text-text placeholder:text-text-muted focus:border-accent";

/** One line or multi-line that grows to ~8 lines, then scrolls. */
export function TextField({ label, multiline, suggestions, ...props }: FieldProps) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const value = props.value;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the value changes
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return multiline ? (
    <textarea
      aria-label={label}
      ref={area}
      rows={1}
      className={cx(fieldCls, "max-h-[12em] resize-none overflow-y-auto")}
      {...(props as object)}
    />
  ) : (
    <>
      <input
        aria-label={label}
        list={suggestions ? id : undefined}
        className={fieldCls}
        {...props}
      />
      {suggestions && (
        <datalist id={id}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}

export type DropdownOption = { value: string; label: string; hint?: string };

/** Listbox popover: mode picker, provider, model, project switcher. */
export function Dropdown({
  options,
  value,
  onChange,
  label,
  up,
  danger,
}: {
  options: DropdownOption[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** open upward (mode picker sits at the bottom) */
  up?: boolean;
  danger?: (v: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the popover
    <div
      ref={root}
      className="relative inline-block"
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1 rounded-control border border-border px-1.5 text-small"
        onClick={() => setOpen(!open)}
      >
        {current?.label ?? value}
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className={cx(
            "absolute left-0 z-10 flex min-w-60 flex-col gap-0.5 rounded-card border border-border bg-surface-raised p-1",
            up ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {options.map((o) => (
            <button
              type="button"
              role="option"
              aria-selected={o.value === value}
              key={o.value}
              className={cx(
                "flex cursor-pointer flex-col rounded-control px-2 py-1.5 text-left hover:bg-match",
                o.value === value && "bg-match",
              )}
              onClick={() => pick(o.value)}
            >
              <b className={cx("font-medium", danger?.(o.value) && "text-danger")}>{o.label}</b>
              {o.hint && <span className="text-small text-text-muted">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type TabItem = { id: string; label: string; count?: number };

/** Shelf, Knowledge. Arrow keys move between tabs; the consumer renders the panel. */
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
}) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    if (d && next) onChange(next.id);
  };
  return (
    <div role="tablist" className="flex gap-3 border-b border-border px-3">
      {tabs.map((t, i) => (
        <button
          type="button"
          role="tab"
          key={t.id}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          className={cx(
            "-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 py-2 text-small",
            t.id === value ? "border-accent text-text" : "border-transparent text-text-muted",
          )}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => move(e, i)}
        >
          {t.label}
          {t.count ? <Count>{t.count}</Count> : null}
        </button>
      ))}
    </div>
  );
}

/** Inline confirm that states the cost first. */
export function Confirm({
  cost,
  confirmLabel = "Delete",
  cancelLabel = "Keep",
  onConfirm,
  onCancel,
}: {
  cost: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-control border border-danger p-2">
      <span>{cost}</span>
      <div className="flex gap-2">
        <button
          type="button"
          className="cursor-pointer rounded-control border border-danger px-2.5 py-0.5 text-small text-danger"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          className="cursor-pointer rounded-control border border-border px-2.5 py-0.5 text-small"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
