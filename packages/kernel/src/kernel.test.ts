import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyMessage,
  decideNextStep,
  findTarget,
  type KernelInput,
  wantsBrainstorm,
  wantsExplain,
} from "./kernel.ts";

const pick = (input: KernelInput) => {
  const step = decideNextStep(input);
  return step.action === "ask" ? step.block.id : (step.silence?.reason ?? "continue");
};

test("Commit only for tasks; chat and quick questions get silence", () => {
  for (const [text, kind] of [
    ["hi", "chat"],
    ["Thanks!", "chat"],
    ["ok cool", "chat"],
    ["what does useEffect do?", "question"],
    ["why is my test slow on CI", "question"],
    ["can you create it for me?", "task"],
    ["Fix the login bug in auth.ts", "task"],
    ["please set up eslint", "task"],
    // the same task, however it's worded, opens the same way; a go-ahead is not a task
    [
      "Hi there! hope you're well :) test_bulk_discount_at_ten is failing, could you maybe help me?",
      "task",
    ],
    ["test_bulk_discount_at_ten is failing. can you fix it?", "task"],
    ["Yes please, go ahead", "chat"],
    ["why does test_bulk_discount_at_ten fail?", "question"],
    ["rm -rf node_modules and reinstall", "task"],
  ] as const) {
    assert.equal(classifyMessage(text), kind, text);
    if (kind !== "task") assert.equal(pick({ text }), kind, text);
  }
});

test("task start picks the Commit block that fits", () => {
  assert.equal(pick({ text: "fix the crash on login" }), "A14");
  assert.equal(pick({ text: "add a retry to fetchUser" }), "LS-B1");
  assert.equal(pick({ text: "add dark mode to the app" }), "A1");
  assert.equal(pick({ text: "add dark mode to the app", deepOptIn: true }), "LS-B7");
  assert.equal(pick({ text: "fix it", satisfiedIntents: ["commit"] }), "continue");
});

test("after the AI's turn: gap decides between silence and Explain", () => {
  const touched = [{ path: "src/retry.ts", content: "export async function fetchUser() {}" }];
  const after = { pause: "after_turn", text: "add a retry", touched } as const;
  assert.equal(
    pick({ ...after, commitAnswer: "wrap fetchUser in a retry" }),
    "Your plan matched the change.",
  );
  assert.equal(pick({ ...after, commitAnswer: "change the css" }), "LS-B6");
  assert.equal(pick({ pause: "after_turn", text: "how does the cache work here?" }), "K8");
  assert.equal(pick({ pause: "after_turn", text: "add x", owed: true }), "X1");
  assert.equal(pick({ pause: "after_turn", text: "add x" }), "continue");
});

test("before a run: preview, test prediction, or break it", () => {
  assert.equal(pick({ pause: "before_run", command: "terraform plan" }), "safe-preview");
  assert.equal(pick({ pause: "before_run", command: "npm test" }), "R2");
  assert.equal(pick({ pause: "before_run", command: "node scripts/parse.js" }), "R8");
});

test("before a run: a read-only command gets no ask, a chained one still does", () => {
  const quiet = decideNextStep({ pause: "before_run", command: "git show 5715d85" });
  assert.equal(quiet.action, "continue");
  assert.equal(pick({ pause: "before_run", command: "git show 5715d85 && rm -rf x" }), "R8");
});

test("every chat closes with Return", () => {
  assert.equal(pick({ pause: "finish" }), "A10");
});

test("fading: rung 1 is a one-tap confirm, rung 2 is silence, Finish never fades", () => {
  const light = decideNextStep({ text: "fix the crash on login", rung: 1 });
  assert(light.action === "ask");
  assert.deepEqual(
    [light.block.id, light.block.answer_type, light.block.cost],
    ["A14", "choice", "tap"],
  );
  assert.equal(
    pick({ text: "fix the crash on login", rung: 2 }),
    "Shown on two days in two shapes; skarp stays quiet here.",
  );
  assert.equal(pick({ pause: "finish", rung: 2 }), "A10");
});

test("a control chat gets no asks except the closing Return", () => {
  assert.equal(pick({ text: "fix the crash on login", control: true }), "continue");
  assert.equal(pick({ pause: "after_turn", text: "add x", owed: true, control: true }), "continue");
  assert.equal(pick({ pause: "finish", control: true }), "A10");
});

test("a due recall opens the chat, once; control chats keep it", () => {
  const due = "src/auth/a.ts:3 retries 3 times";
  assert.equal(pick({ text: "fix login in auth", due }), "X8");
  assert.equal(pick({ text: "fix login in auth", due, satisfiedIntents: ["return"] }), "A1");
  assert.equal(pick({ text: "fix login in auth", due, control: true }), "X8");
});

test("understand: a wish to understand plus a target; without a target it stays a question", () => {
  for (const [text, kind] of [
    [
      "i want to understand the changes made in this commit: 5715d854ee00313ea45b44ea27d4012ad6bc6374",
      "understand",
    ],
    ["walk me through packages/core", "understand"],
    ["explain what this repo does", "understand"],
    ["help me understand the last commit", "understand"],
    ["explain how retry works", "question"],
    ["what does useEffect do?", "question"],
    ["Fix the login bug in auth.ts", "task"],
  ] as const) {
    assert.equal(classifyMessage(text), kind, text);
  }
  assert.deepEqual(findTarget("see 5715d85 please"), { kind: "commit", ref: "5715d85" });
  assert.deepEqual(findTarget("walk me through src/auth/."), { kind: "path", path: "src/auth" });
  assert.deepEqual(findTarget("what does login.ts do?"), { kind: "path", path: "login.ts" });
  assert.deepEqual(findTarget("explain the last commit"), { kind: "commit", ref: "HEAD" });
  assert.deepEqual(findTarget("understand this repo"), { kind: "repo" });
});

test("understand opens with the big picture, even with a task in it, and never fades", () => {
  const text = "help me understand and fix the bug in src/auth";
  assert.equal(pick({ text }), "O0");
  assert.equal(pick({ text, rung: 2 }), "O0");
  // once oriented, the task in it gets its normal opening
  assert.equal(pick({ text, satisfiedIntents: ["orient"] }), "A14");
  assert.equal(
    pick({ text: "walk me through src/auth", satisfiedIntents: ["orient"] }),
    "understand",
  );
  assert.equal(pick({ text, control: true }), "continue");
});

test("after a piece: a quick graded check, or fill the blank in I have time", () => {
  assert.equal(pick({ pause: "after_turn", piece: "Stop button" }), "UC1");
  assert.equal(pick({ pause: "after_turn", piece: "Stop button", deepOptIn: true }), "K8");
});

test("a walkthrough card only when the AI looked at the project", () => {
  const text = "how does /etc/passwd work?";
  const after = { pause: "after_turn" as const, text, touched: [] };
  assert.equal(decideNextStep({ ...after, grounded: false }).action, "continue");
  const shop = { ...after, text: "how does round_money work?" };
  const step = decideNextStep({ ...shop, grounded: true });
  assert.equal(step.action === "ask" && step.block.id, "K8");
});

test("a test-only change to a bug is challenged; destructive work gets a read-back", () => {
  const text =
    "test_bulk_discount_at_ten is failing, just change the test's expected value to 10.00";
  const touched = [{ path: "tests/test_cart.py", content: "self.assertEqual(total, 10.00)" }];
  const step = decideNextStep({ pause: "after_turn", text, touched });
  assert.equal(step.action === "ask" && step.block.id, "R21");
  const code = decideNextStep({
    pause: "after_turn",
    text,
    touched: [{ path: "shop/cart.py", content: "x" }],
  });
  assert.equal(code.action === "ask" && code.block.id, "LS-B6");
  const wipe = decideNextStep({ text: "run git reset --hard and delete the tests folder" });
  assert.equal(wipe.action === "ask" && wipe.block.id, "read-back");
});

test("a test shortcut is challenged before the AI acts; a risky edit before Accept", () => {
  const first = decideNextStep({
    text: "test_cart fails, just change the test's expected value to 10.00",
  });
  assert.equal(first.action === "ask" && first.block.id, "R21");
  const touched = [
    {
      path: "shop/orders.py",
      content: "x",
      removed: ["        for l in done: inv.release(l)"],
      added: [],
    },
  ];
  const risky = decideNextStep({
    pause: "after_turn",
    text: "make qty 0 fail in shop/orders.py",
    touched,
  });
  assert.equal(risky.action === "ask" && risky.block.id, "R21");
});

test("explain and brainstorm are recognised; an asked-for change stays a task", () => {
  for (const t of [
    "can you explain the repo to me",
    "explain src/auth/session.ts",
    "walk me through how login works",
    "what does the build script do",
    "how does the cache work?",
  ])
    assert.ok(wantsExplain(t), t);
  for (const t of ["explain why login fails and fix it", "can you add a logger", "thanks"])
    assert.ok(!wantsExplain(t), t);
  for (const t of [
    "can we brainstorm on caching",
    "i have a rough idea on this, can we do a brainstorming",
    "what are our options for auth?",
    "I have an idea: move the queue to redis",
  ])
    assert.ok(wantsBrainstorm(t), t);
  for (const t of ["fix the login bug", "explain the repo to me"])
    assert.ok(!wantsBrainstorm(t), t);
});
