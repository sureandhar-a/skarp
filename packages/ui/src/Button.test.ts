import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { Button } from "./Button.tsx";

test("Button renders its label and variant", () => {
  const html = renderToString(createElement(Button, { variant: "danger" }, "Stop"));
  expect(html).toContain("Stop");
  expect(html).toContain("text-danger");
});
