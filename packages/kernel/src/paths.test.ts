import assert from "node:assert/strict";
import { test } from "node:test";
import { pathAllowed } from "./paths.ts";

test("tools may touch workspace files only, never secrets", () => {
  for (const p of ["src/a.ts", "README.md", "packages/core/src/core.ts", ".github/ci.yml"]) {
    assert.equal(pathAllowed(p), true, p);
  }
  for (const p of [
    "",
    "/etc/passwd",
    "C:/x.ts",
    "..\\x",
    "../outside.ts",
    "src/../../x",
    ".env",
    "app/.env.local",
    "certs/server.pem",
    "deploy/prod.key",
    ".git/config",
  ]) {
    assert.equal(pathAllowed(p), false, p);
  }
});
