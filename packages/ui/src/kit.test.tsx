import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import {
  AskCard,
  BalanceStatus,
  ChangesBar,
  Choice,
  KnowledgeRow,
  LightLine,
  moveItem,
} from "./index.ts";

test("moveItem reorders and ignores out-of-range moves", () => {
  expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
});

test("ask card shows intent word, question and numbered choices", () => {
  const html = renderToString(
    <AskCard intent="commit" question="Which files?">
      <Choice options={["one", "two"]} onPick={() => {}} />
    </AskCard>,
  );
  for (const s of ["Commit", "Which files?", "one", "Not yet"]) expect(html).toContain(s);
});

test("balance never says correct", () => {
  expect(renderToString(<BalanceStatus level />)).toContain("in balance");
  expect(renderToString(<BalanceStatus level={false} />)).toContain("not in balance yet");
});

test("changes bar sums the diff; light line opens in place", () => {
  const files = [
    { path: "a.ts", add: 6, del: 1 },
    { path: "b.ts", add: 2, del: 0 },
  ];
  expect(renderToString(<ChangesBar files={files} />)).toContain("+8 −1");
  expect(
    renderToString(
      <LightLine rows={[["Asked", "why"]]} defaultOpen>
        x
      </LightLine>,
    ),
  ).toContain("Asked");
});

test("knowledge row shows no score", () => {
  const html = renderToString(
    <KnowledgeRow name="Tokens" folder="auth/" stage={2} depth="applied" />,
  );
  expect(html).toContain("quick check");
  expect(html).not.toMatch(/miss|hit|%/);
});
