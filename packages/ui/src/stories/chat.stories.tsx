import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  ActivityLine,
  AskCard,
  BalanceStatus,
  Button,
  Card,
  ChangesBar,
  ChatHeader,
  Choice,
  EvidenceLink,
  LightLine,
  Message,
  MessageBox,
  ModePicker,
  SegmentDivider,
  type Session,
  SessionsList,
  SpeakerGroup,
  StartScreen,
  Strip,
  UserBubble,
} from "../index.ts";

const meta: Meta = { title: "Chat" };
export default meta;
type S = StoryObj;

const files = [
  { path: "billing/charge.ts", add: 6, del: 1 },
  { path: "billing/retry.ts", add: 2, del: 0 },
];

const sessions: Session[] = [
  { id: "1", title: "Learning the auth module", status: "done", pinned: true },
  { id: "2", title: "Charge retry", status: "question", detail: "2 files" },
  { id: "3", title: "Retry config", status: "working", child: true },
  {
    id: "4",
    title: "Webhook signature",
    status: "waiting",
    detail: "waiting on Charge retry",
    child: true,
  },
  { id: "5", title: "Token cache", status: "done", detail: "3 files" },
];

function Box({ working }: { working?: boolean }) {
  const [v, setV] = useState("");
  const [m, setM] = useState("quick");
  const [model, setModel] = useState("copilot:gpt-4.1");
  return (
    <MessageBox
      value={v}
      onChange={setV}
      onSend={() => setV("")}
      working={working}
      mode={m}
      onMode={setM}
      models={[
        { value: "copilot:gpt-4.1", label: "GPT-4.1" },
        { value: "copilot:gpt-4o-mini", label: "GPT-4o mini" },
        { value: "gemini", label: "Gemini (gemini-3.6-flash)" },
      ]}
      model={model}
      onModel={setModel}
    />
  );
}

export const Header: S = {
  render: () => (
    <div className="flex flex-col gap-4">
      <ChatHeader
        title="Charge retry"
        onBack={() => {}}
        onNew={() => {}}
        onRecall={() => {}}
        onFinish={() => {}}
      />
      <ChatHeader title="skarp" onNew={() => {}} onRecall={() => {}} />
    </div>
  ),
};

export const MidChat: S = {
  name: "Mid-chat (assistant working)",
  render: () => (
    <div className="flex flex-col border border-border">
      <ChatHeader
        title="Charge retry"
        onBack={() => {}}
        onNew={() => {}}
        onRecall={() => {}}
        onFinish={() => {}}
      />
      <div className="flex flex-col gap-2.5 p-3">
        <SpeakerGroup who="skarp">
          <LightLine icon="history">Due item moved to later · on your shelf</LightLine>
        </SpeakerGroup>
        <UserBubble initial="S" reads="work · change">
          Charges run twice on retry
        </UserBubble>
        <SpeakerGroup who="skarp">
          <LightLine icon="edit">
            You placed the bug at <code>retry.ts:18</code>
          </LightLine>
        </SpeakerGroup>
        <Message showName streaming srSummary="Assistant is editing charge.ts">
          Looking at the retry path first. The key is created per attempt, so a retry sends a new
          one.
          <ActivityLine>
            Editing <code>charge.ts</code>…
          </ActivityLine>
        </Message>
      </div>
      <div className="flex flex-col gap-2 border-t border-border p-3">
        <AskCard intent="fly" question="Will the fix touch retry.ts?" pinned>
          <Choice options={["yes", "no"]} onPick={() => {}} />
        </AskCard>
        <ChangesBar files={files.slice(0, 1)} />
        <Box working />
      </div>
    </div>
  ),
};

export const EndOfChat: S = {
  name: "End of chat (lines open in place, U78)",
  render: () => (
    <div className="flex flex-col gap-2.5 p-3">
      <SpeakerGroup who="skarp">
        <LightLine
          icon="edit"
          defaultOpen
          result={<BalanceStatus level={false} />}
          rows={[
            ["Asked", "Where do you think the bug is?"],
            [
              "You",
              <span key="y">
                <code>retry.ts:18</code> · maybe
              </span>,
            ],
            [
              "Evidence",
              <span key="e">
                <EvidenceLink file="charge.ts" line={42} /> creates a new key on every attempt
              </span>,
            ],
            ["Result", <BalanceStatus key="r" level={false} />],
          ]}
          footer={
            <div className="border-t border-border pt-1.5 text-small">
              Why this: <code>billing/</code> is new to you.
            </div>
          }
        >
          You placed it at <code>retry.ts:18</code>
        </LightLine>
      </SpeakerGroup>
      <Message>Moved key creation out of the retry loop.</Message>
      <SpeakerGroup who="skarp" showName>
        <LightLine
          icon="beaker"
          result={<BalanceStatus level />}
          rows={[
            [
              "Asked",
              <span key="a">
                Will <code>npm test</code> pass now?
              </span>,
            ],
            ["You", "it passes · sure"],
            [
              "Ran",
              <span key="r">
                <code>npm test</code> · 14 of 14 passed · 3.2 s
              </span>,
            ],
            ["Result", <BalanceStatus key="b" level />],
          ]}
          footer={
            <button type="button" className="self-start cursor-pointer text-accent">
              Show output
            </button>
          }
        >
          You said: sure, tests pass · ran <code>npm test</code>, 14 of 14
        </LightLine>
        <Card title="What grew" className="mt-1">
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 text-small">
            <span className="text-text-muted">Deeper</span>
            <span>idempotency keys</span>
            <span className="text-text-muted">Corrected</span>
            <span>
              the bug was in <code>charge.ts</code>, not <code>retry.ts</code>
            </span>
            <span className="text-text-muted">Still thin</span>
            <span>lock ordering, on your shelf</span>
            <span className="text-text-muted">Lighter next time</span>
            <span>retry basics</span>
          </div>
        </Card>
      </SpeakerGroup>
    </div>
  ),
};

export const Changes: S = {
  name: "ChangesBar",
  render: () => (
    <div className="flex flex-col gap-3">
      <ChangesBar files={files.slice(0, 1)} />
      <ChangesBar files={files} defaultOpen />
      <ChangesBar files={files} accepted notice="1 test failed · a fix is coming" />
    </div>
  ),
};

export const Boxes: S = {
  name: "MessageBox + ModePicker",
  render: () => (
    <div className="flex flex-col gap-6" style={{ minHeight: 360 }}>
      <Box />
      <Box working />
    </div>
  ),
};

export const Modes: S = {
  name: "ModePicker only",
  render: () => {
    const [m, setM] = useState("time");
    return (
      <div style={{ paddingTop: 140 }}>
        <ModePicker value={m} onChange={setM} />
      </div>
    );
  },
};

export const Sessions: S = {
  name: "SessionsList (pinned, linked, badge)",
  render: () => (
    <SessionsList
      sessions={sessions}
      onNew={() => {}}
      onPin={() => {}}
      onArchive={() => {}}
      onDelete={() => {}}
    />
  ),
};

export const Start: S = {
  name: "StartScreen (empty / with sessions)",
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="border border-border">
        <StartScreen>
          <Box />
        </StartScreen>
      </div>
      <div className="border border-border">
        <StartScreen
          sessions={sessions.filter((s) => !s.child).slice(1, 3)}
          due={
            <Card
              title="Token refresh"
              actions={
                <>
                  <Button>Answer now</Button>
                  <Button variant="quiet">Later</Button>
                </>
              }
            >
              <span className="text-text-muted">Recall due today</span>
            </Card>
          }
        >
          <Box />
        </StartScreen>
      </div>
    </div>
  ),
};

export const OffForChat: S = {
  name: "Strip + SegmentDivider + stop confirm",
  render: () => (
    <div className="flex flex-col gap-3">
      <Strip action="Turn on">skarp off for this chat</Strip>
      <p className="m-0 text-text-muted">
        skarp is off for this chat. Nothing owed. I've noted that you turned it off.
      </p>
      <SegmentDivider />
      <Card
        title="Turn skarp off for this chat?"
        actions={
          <>
            <Button>Yes</Button>
            <Button variant="quiet">No</Button>
          </>
        }
      />
    </div>
  ),
};
