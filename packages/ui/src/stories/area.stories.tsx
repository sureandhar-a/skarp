import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  AreaHeader,
  Button,
  ConceptPage,
  Dropdown,
  EvidenceLink,
  GroupHeading,
  KnowledgeRow,
  SettingRow,
  SettingsPage,
  SettingsSection,
  ShelfRow,
  Tabs,
  TextField,
} from "../index.ts";

const meta: Meta = { title: "skarp area" };
export default meta;
type S = StoryObj;

export const Header: S = {
  render: () => (
    <div className="flex flex-col gap-4">
      <AreaHeader project="shop-api" />
      <AreaHeader project="shop-api" stopped />
    </div>
  ),
};

export const Shelf: S = {
  name: "Shelf (grouped by when)",
  render: () => {
    const [tab, setTab] = useState("shelf");
    return (
      <div className="border border-border">
        <AreaHeader project="shop-api" />
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "shelf", label: "Shelf", count: 2 },
            { id: "knowledge", label: "Knowledge" },
          ]}
        />
        <div className="flex flex-col gap-1 p-3">
          <GroupHeading>Due now</GroupHeading>
          <ShelfRow
            kind="recall"
            title="Token refresh"
            meta="recall · due today"
            actions={[{ label: "Answer now" }]}
            deleteCost="Removes this recall. Theory Card rows stay."
          />
          <ShelfRow
            kind="doubt"
            title={<code>billing/charge.ts:42</code>}
            meta="doubt · marked yesterday"
            actions={[
              { label: "Run" },
              { label: "Ask" },
              { label: "Read" },
              { label: "Open line" },
            ]}
          />
          <GroupHeading>Later</GroupHeading>
          <ShelfRow
            kind="not-yet"
            title="Why the lock is needed"
            meta={
              <>
                not yet · from “Charge retry” · when you next touch <code>billing/</code>
              </>
            }
          />
          <ShelfRow
            kind="not-run"
            title={<code>npm test</code>}
            meta="not run · from “Charge retry”"
            actions={[{ label: "Run now" }]}
          />
          <ShelfRow
            kind="owed"
            title="Session expiry: first question"
            meta="skarp stayed quiet here · next Return"
          />
          <GroupHeading>No date</GroupHeading>
          <ShelfRow kind="hotfix" title="Webhook fix" meta="hotfix · no due date" />
        </div>
      </div>
    );
  },
};

export const Knowledge: S = {
  name: "KnowledgeRow",
  render: () => (
    <div className="flex flex-col gap-1">
      <KnowledgeRow
        name="Idempotency keys"
        folder="billing/"
        stage={1}
        depth="explained"
        shelfCount={1}
      />
      <KnowledgeRow name="Token refresh" folder="auth/" stage={2} depth="applied" />
      <KnowledgeRow name="Retry basics" folder="billing/" stage={3} depth="taught" />
    </div>
  ),
};

export const Concept: S = {
  name: "ConceptPage",
  render: () => (
    <ConceptPage
      name="Idempotency keys"
      rows={[
        {
          words: "the key makes the second call a no-op",
          evidence: <EvidenceLink file="billing/charge.ts" line={42} />,
          why: "you explained it unprompted",
        },
        {
          words: "keys are per order, not per attempt",
          evidence: <EvidenceLink file="billing/retry.ts" line={18} />,
          why: "corrected in Charge retry",
          stale: true,
        },
      ]}
      moments={[
        "Charge retry · yesterday · corrected",
        "Webhook signature · 3 days ago · explained",
      ]}
      shelf={<ShelfRow kind="not-yet" title="Why the lock is needed" meta="not yet" />}
      deleteCost="Deletes this concept, 2 Theory Card rows and 1 shelf item."
      onBack={() => {}}
    />
  ),
};

export const Settings: S = {
  name: "SettingsPage",
  render: () => {
    const [p, setP] = useState("copilot");
    const [m, setM] = useState("quick");
    return (
      <SettingsPage onBack={() => {}}>
        <SettingsSection title="Model">
          <SettingRow label="Provider">
            <Dropdown
              label="Provider"
              value={p}
              onChange={setP}
              options={[
                { value: "copilot", label: "Copilot" },
                { value: "key", label: "Your API key" },
              ]}
            />
          </SettingRow>
          <SettingRow label="API key">
            <TextField label="API key" type="password" placeholder="Stored in the OS keychain" />
          </SettingRow>
        </SettingsSection>
        <SettingsSection title="New chats">
          <SettingRow label="Default mode">
            <Dropdown
              label="Default mode"
              value={m}
              onChange={setM}
              options={[
                { value: "quick", label: "Quick" },
                { value: "time", label: "I have time" },
              ]}
            />
          </SettingRow>
        </SettingsSection>
        <SettingsSection title="Your data">
          <SettingRow label="Stored in">
            <code>~/.skarp</code>
          </SettingRow>
          <div className="flex gap-2">
            <Button variant="quiet">Export all</Button>
            <Button variant="danger">Delete all</Button>
          </div>
        </SettingsSection>
      </SettingsPage>
    );
  },
};
