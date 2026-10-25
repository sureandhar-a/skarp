import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  AskCard,
  Button,
  Card,
  Choice,
  Confidence,
  EvidenceLink,
  LightLine,
  LinePicker,
  OrderAnswer,
  SkipReasons,
  TextAnswer,
  UndoLine,
} from "../index.ts";

const meta: Meta = { title: "Ask card" };
export default meta;
type S = StoryObj;

const files = [
  <span key="a">
    only <code>charge.ts</code>
  </span>,
  <span key="b">
    <code>charge.ts</code> and <code>retry.ts</code>
  </span>,
  <span key="c">
    <code>charge.ts</code> and the tests
  </span>,
];

export const ChoiceAsk: S = {
  name: "Choice (tap sends, 3 s undo)",
  render: () => {
    const [sent, setSent] = useState<number | null>(null);
    return (
      <AskCard
        intent="commit"
        question="Before I build: which files will this touch?"
        why={
          <>
            <code>billing/</code> is new to you.
          </>
        }
        onLighter={() => {}}
        onMore={() => {}}
      >
        <Choice options={files} onPick={setSent} />
        {sent !== null && <UndoLine onUndo={() => setSent(null)} />}
      </AskCard>
    );
  },
};

export const TextAsk: S = {
  name: "Text with evidence",
  render: () => {
    const [v, setV] = useState("");
    return (
      <AskCard
        intent="explain"
        question="This works because ___"
        why="you explained this last week."
      >
        <TextAnswer
          value={v}
          onChange={setV}
          onSend={() => {}}
          evidence={
            <span className="text-small text-text-muted">
              Evidence: <EvidenceLink file="charge.ts" line={42} />
            </span>
          }
        />
      </AskCard>
    );
  },
};

export const OrderAsk: S = {
  name: "Order (drag or Alt+arrows)",
  render: () => {
    const [items, setItems] = useState([
      "validate the token",
      "read the cache",
      "refresh if expired",
    ]);
    return (
      <AskCard intent="hear" question="Put these steps in the order the code runs them" hideActions>
        <OrderAnswer items={items} onChange={setItems} onSend={() => {}} />
      </AskCard>
    );
  },
};

export const LineAsk: S = {
  name: "LinePicker (mark a line / evidence)",
  render: () => {
    const [v, setV] = useState("");
    return (
      <AskCard intent="commit" question="Where do you think the bug is?">
        <LinePicker
          options={[
            { file: "billing/retry.ts", line: 18 },
            { file: "billing/charge.ts", line: 42 },
          ]}
          value={v}
          onChange={setV}
          onPickInEditor={() => {}}
        />
      </AskCard>
    );
  },
};

export const ConfidenceAsk: S = {
  name: "Confidence (s / m / g)",
  render: () => (
    <AskCard intent="check" question="Will the test pass?">
      <Confidence onPick={() => {}} />
    </AskCard>
  ),
};

export const Pinned: S = {
  name: "Pinned above the message box (U18)",
  render: () => (
    <AskCard intent="fly" question="Will the fix touch retry.ts?" pinned>
      <Choice options={["yes", "no"]} onPick={() => {}} />
    </AskCard>
  ),
};

export const Fallback: S = {
  name: "Fallback note (U29)",
  render: () => (
    <AskCard
      intent="explain"
      question="You said retry is safe. Which line shows it?"
      fallbackNote="built from your past words · model reply failed checks"
      hideActions
    />
  ),
};

export const Offer: S = {
  name: "Deep block offer (U20)",
  render: () => (
    <AskCard intent="commit" intentNote="offer" question="One real try · about 5 min" hideActions>
      <div className="text-text-muted">
        Write it yourself first, then compare with the assistant's version.
      </div>
      <div className="flex gap-2">
        <Button>Try it</Button>
        <Button variant="quiet">Not now</Button>
      </div>
    </AskCard>
  ),
};

export const AfterAnswer: S = {
  name: "After answering, after Skip",
  render: () => (
    <div className="flex flex-col gap-4">
      <LightLine icon="arrow-right">
        You: <code>charge.ts</code> and <code>retry.ts</code> · maybe
      </LightLine>
      <SkipReasons />
    </div>
  ),
};

export const CardShell: S = {
  name: "Card shell (welcome, no model)",
  render: () => (
    <div className="flex flex-col gap-3">
      <Card
        title="Before we start"
        actions={
          <>
            <Button>Use Copilot</Button>
            <Button variant="quiet">Add your API key</Button>
          </>
        }
      >
        <div className="text-text-muted">
          Everything skarp keeps about you is stored on your machine, in plain files you can open.
        </div>
      </Card>
      <Card
        title="Copilot's quota is used up."
        actions={
          <>
            <Button>Use your API key</Button>
            <Button variant="quiet">Try Copilot again</Button>
          </>
        }
      >
        <div className="text-text-muted">Use your API key or try later.</div>
      </Card>
    </div>
  ),
};

export const Orient: S = {
  name: "Orient: Where do we start? (D117)",
  render: () => (
    <AskCard
      pinned
      hideActions
      intent="orient"
      question="Where do we start?"
      why="New ground: pick a piece, and we go one at a time."
    >
      <Choice
        options={["Stop button", "Pager fix", "git_info commits", "Big picture first"]}
        onPick={() => {}}
      />
    </AskCard>
  ),
};

export const NextPiece: S = {
  name: "Orient: the check and Next piece? in one card (D127)",
  render: () => (
    <AskCard
      pinned
      hideActions
      intent="orient"
      question="Next piece?"
      why="2 left; go on, or stop here."
      lead={
        <LightLine
          icon="check"
          result="answered"
          rows={[["You said", "It sends Ctrl+C and returns at once"]]}
        >
          Stop ends a hung run because ___.
        </LightLine>
      }
    >
      <Choice options={["Pager fix", "git_info commits", "Done for now"]} onPick={() => {}} />
    </AskCard>
  ),
};
