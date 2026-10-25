import assert from "node:assert/strict";
import { test } from "node:test";
import { ALIGNED, overlap, tokens } from "./gap.ts";

test("identifiers split into parts and keep the whole", () => {
  assert.deepEqual(tokens("getUserById"), ["getuserbyid", "get", "user", "id"]);
  assert.deepEqual(tokens("HTTPServer"), ["httpserver", "http", "server"]);
  assert.deepEqual(tokens("src/auth/login.ts"), [
    "src/auth/login.ts",
    "src",
    "auth",
    "login",
    "ts",
  ]);
  assert.deepEqual(tokens("the and of"), []);
});

test("aligned when the answer matches what the AI touched, diverged when not", () => {
  const touched = [
    {
      path: "src/session.ts",
      content: "export function refreshToken(expiry: number) {\n  return expiry > now();\n}",
    },
  ];
  assert.equal(overlap("I think it's in src/session.ts", touched), 1);
  assert(overlap("the refresh token expiry check is wrong", touched) >= ALIGNED);
  assert(overlap("probably the css layout in the navbar", touched) < ALIGNED);
  assert.equal(overlap("", touched), 0);
});
