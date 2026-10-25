import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  Badge,
  BalanceStatus,
  Button,
  Chip,
  Confirm,
  Count,
  Dropdown,
  EvidenceLink,
  INTENTS,
  type Intent,
  IntentLabel,
  KeyHint,
  Mark,
  SpeakerIcon,
  Tabs,
  TextField,
} from "../index.ts";

const meta: Meta = { title: "Foundations" };
export default meta;
type S = StoryObj;

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2 pb-3">{children}</div>
);

export const Buttons: S = {
  render: () => (
    <Row>
      <Button>Answer now</Button>
      <Button variant="quiet">Not now</Button>
      <Button variant="danger">Delete</Button>
      <Button disabled>Disabled</Button>
    </Row>
  ),
};

export const SmallMarks: S = {
  name: "Chip · Badge · Count · KeyHint · EvidenceLink",
  render: () => (
    <>
      <Row>
        <Chip>already know</Chip>
        <Chip selected>no time</Chip>
        <Chip onClick={() => {}}>clickable</Chip>
      </Row>
      <Row>
        <Badge>stale</Badge>
        <Badge tone="accent">question waiting</Badge>
        <Count>2</Count>
      </Row>
      <Row>
        <KeyHint>1</KeyHint>
        <KeyHint>Alt</KeyHint>
        <KeyHint>Enter</KeyHint>
      </Row>
      <Row>
        <EvidenceLink file="billing/charge.ts" line={42} />
        <EvidenceLink file="billing/retry.ts" />
      </Row>
    </>
  ),
};

export const Intents: S = {
  name: "IntentLabel (U34, U41)",
  render: () => (
    <div className="flex flex-col gap-1.5">
      {(Object.keys(INTENTS) as Intent[]).map((i) => (
        <IntentLabel key={i} intent={i} />
      ))}
      <IntentLabel intent="commit" note="offer" />
    </div>
  ),
};

export const Speakers: S = {
  name: "SpeakerIcon · Mark",
  render: () => (
    <>
      <Row>
        <SpeakerIcon who="skarp" />
        <SpeakerIcon who="assistant" />
        <SpeakerIcon who="you" initial="S" />
      </Row>
      <Row>
        <Mark className="size-10" />
        <Mark tipped className="size-10" />
      </Row>
    </>
  ),
};

export const Balance: S = {
  name: "BalanceStatus (U76)",
  render: () => (
    <Row>
      <BalanceStatus level />
      <BalanceStatus level={false} />
    </Row>
  ),
};

export const TextFields: S = {
  name: "TextField",
  render: () => {
    const [one, setOne] = useState("");
    const [many, setMany] = useState("");
    return (
      <div className="flex flex-col gap-2">
        <TextField
          label="Evidence"
          placeholder="file:line (try typing 'bill')"
          value={one}
          onChange={(e) => setOne(e.currentTarget.value)}
          suggestions={["billing/charge.ts:42", "billing/retry.ts:18"]}
        />
        <TextField
          label="Answer"
          multiline
          placeholder="Grows with your text, then scrolls"
          value={many}
          onChange={(e) => setMany(e.currentTarget.value)}
        />
      </div>
    );
  },
};

export const Dropdowns: S = {
  name: "Dropdown",
  render: () => {
    const [v, setV] = useState("copilot");
    return (
      <div style={{ minHeight: 160 }}>
        <Dropdown
          label="Provider"
          value={v}
          onChange={setV}
          options={[
            { value: "copilot", label: "Copilot" },
            { value: "key", label: "Your API key", hint: "stored in the OS keychain" },
          ]}
        />
      </div>
    );
  },
};

export const TabBar: S = {
  name: "Tabs",
  render: () => {
    const [v, setV] = useState("shelf");
    return (
      <Tabs
        value={v}
        onChange={setV}
        tabs={[
          { id: "shelf", label: "Shelf", count: 2 },
          { id: "knowledge", label: "Knowledge" },
        ]}
      />
    );
  },
};

export const Confirms: S = {
  name: "Confirm (shows the cost, U43)",
  render: () => (
    <Confirm
      cost="Delete “Token refresh”? skarp forgets 3 Theory Card rows."
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  ),
};
