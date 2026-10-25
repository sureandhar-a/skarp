import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// the kernel's purity is guaranteed by the build, not by discipline.
const forbidden = /from\s+["'](node:|fs|net|http|https|child_process|vscode)/;

test("kernel sources import no I/O", () => {
  const dir = new URL(".", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    assert.doesNotMatch(readFileSync(new URL(f, dir), "utf8"), forbidden, f);
  }
});
