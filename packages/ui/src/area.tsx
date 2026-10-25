// skarp area: header, shelf, knowledge, concept page, settings.
import { type ReactNode, useState } from "react";
import { Badge, Confirm, cx, Icon, Mark } from "./basics.tsx";

/** Mark, project (switch), stop everywhere, settings. */
export function AreaHeader({
  project,
  stopped,
  onSwitchProject,
  onToggleStop,
  onSettings,
}: {
  project: string;
  /** stopped everywhere: the same icon turns skarp back on */
  stopped?: boolean;
  onSwitchProject?: () => void;
  onToggleStop?: () => void;
  onSettings?: () => void;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-small">
      <Mark className="size-4" />
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-0.5 font-medium"
        onClick={onSwitchProject}
      >
        {project}
        <Icon name="chevron-down" />
      </button>
      <span className="ml-auto flex gap-3">
        <button
          type="button"
          aria-label={stopped ? "Turn skarp on everywhere" : "Stop skarp everywhere"}
          title={stopped ? "Turn skarp on everywhere" : "Stop skarp everywhere"}
          className={cx("cursor-pointer", stopped ? "text-accent" : "text-danger")}
          onClick={onToggleStop}
        >
          <Icon name={stopped ? "play" : "debug-stop"} />
        </button>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className="cursor-pointer text-text-muted"
          onClick={onSettings}
        >
          <Icon name="gear" />
        </button>
      </span>
    </header>
  );
}

export const GroupHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="m-0 mt-1.5 text-small font-medium text-text-muted">{children}</h3>
);

export const SHELF_ICONS = {
  "not-yet": "clock",
  owed: "eye-closed",
  recall: "history",
  doubt: "question",
  "not-run": "terminal",
  hotfix: "flame",
} as const;
export type ShelfKind = keyof typeof SHELF_ICONS;

/** Type icon, title, muted source line, actions; "..." menu with the inline cost confirm. */
export function ShelfRow({
  kind,
  title,
  meta,
  actions,
  deleteCost,
  onDelete,
}: {
  kind: ShelfKind;
  title: ReactNode;
  meta: ReactNode;
  /** first is the main action, e.g. ["Answer now"] or ["Run","Ask","Read","Open line"] */
  actions?: { label: string; onClick?: () => void }[];
  deleteCost?: ReactNode;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="group grid grid-cols-[18px_minmax(0,1fr)_16px] items-start gap-2 rounded-card p-1.5 hover:bg-surface-raised">
      <Icon name={SHELF_ICONS[kind]} className="mt-0.5 text-text-muted" />
      <div className="flex min-w-0 flex-col">
        <div>{title}</div>
        <div className="text-small text-text-muted">{meta}</div>
        {actions && (
          <div className="mt-0.5 flex gap-2.5 text-small">
            {actions.map((a, i) => (
              <button
                type="button"
                key={a.label}
                className={cx("cursor-pointer", i === 0 ? "text-accent" : "text-text-muted")}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        {confirming && (
          <div className="mt-1.5">
            <Confirm
              cost={deleteCost ?? "This removes it from your shelf."}
              onConfirm={() => {
                setConfirming(false);
                onDelete?.();
              }}
              onCancel={() => setConfirming(false)}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={`More for ${typeof title === "string" ? title : "this item"}`}
        className="cursor-pointer text-text-muted opacity-60 hover:opacity-100"
        onClick={() => setConfirming(true)}
      >
        <Icon name="ellipsis" />
      </button>
    </div>
  );
}

export type Stage = 1 | 2 | 3; // full question -> quick check -> quiet
const STAGE_WORDS = ["full question", "quick check", "quiet"];

export function StageDots({ stage }: { stage: Stage }) {
  return (
    <span
      role="img"
      aria-label={`stage: ${STAGE_WORDS[stage - 1]}`}
      className="tracking-widest text-accent"
    >
      {[1, 2, 3].map((n) => (
        <span key={n} className={n > stage ? "text-border" : undefined} aria-hidden="true">
          {n <= stage ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

/** name, folder, stage, depth, shelf count. No score, no hits or misses. */
export function KnowledgeRow({
  name,
  folder,
  stage,
  depth,
  shelfCount,
  onOpen,
}: {
  name: string;
  folder: string;
  stage: Stage;
  /** absent until a pass shows one */
  depth?: "explained" | "applied" | "taught";
  shelfCount?: number;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer flex-col gap-0.5 rounded-card p-1.5 text-left hover:bg-surface-raised"
      onClick={onOpen}
    >
      <span className="flex items-baseline gap-2">
        <span>{name}</span>
        <code className="text-text-muted">{folder}</code>
      </span>
      <span className="flex flex-wrap items-center gap-2.5 text-small text-text-muted">
        <StageDots stage={stage} />
        {depth && <span>{depth}</span>}
        {shelfCount ? <Badge tone="count">{shelfCount} on shelf</Badge> : null}
      </span>
    </button>
  );
}

export type TheoryRow = { words: string; evidence: ReactNode; why: string; stale?: boolean };

/** Drill-in page of one concept: Theory Card rows, Moments, On your shelf, Delete. */
export function ConceptPage({
  name,
  rows,
  moments,
  shelf,
  deleteCost,
  onBack,
  onDelete,
}: {
  name: string;
  rows: TheoryRow[];
  moments: ReactNode[];
  shelf?: ReactNode;
  deleteCost: ReactNode;
  onBack?: () => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const h = "m-0 text-small font-medium text-text-muted";
  return (
    <div className="flex flex-col gap-3 p-3">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 self-start font-medium"
        onClick={onBack}
      >
        <Icon name="arrow-left" />
        {name}
      </button>
      <h3 className={h}>Theory Card</h3>
      {rows.map((r) => (
        <div
          key={r.words}
          className="flex flex-col gap-0.5 rounded-control border border-border px-2 py-1.5"
        >
          <span>
            “{r.words}” {r.stale && <Badge>stale</Badge>}
          </span>
          <span className="text-small text-text-muted">{r.evidence}</span>
          <span className="text-small text-text-muted">Why kept: {r.why}</span>
        </div>
      ))}
      <h3 className={h}>Moments</h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-text-muted">
        {moments.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <li key={i}>{m}</li>
        ))}
      </ul>
      {shelf && (
        <>
          <h3 className={h}>On your shelf</h3>
          {shelf}
        </>
      )}
      {confirming ? (
        <Confirm
          cost={deleteCost}
          onConfirm={() => {
            setConfirming(false);
            onDelete?.();
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button
          type="button"
          className="cursor-pointer self-start text-small text-danger"
          onClick={() => setConfirming(true)}
        >
          Delete concept
        </button>
      )}
    </div>
  );
}

/** Settings sections: Model, New chats, Keyboard, Your data. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-border py-3 first:pt-0 last:border-0">
      <h3 className="m-0 font-medium">{title}</h3>
      {children}
    </section>
  );
}

export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
      <span className="text-text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsPage({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 self-start font-medium"
        onClick={onBack}
      >
        <Icon name="arrow-left" />
        Settings
      </button>
      {children}
    </div>
  );
}
