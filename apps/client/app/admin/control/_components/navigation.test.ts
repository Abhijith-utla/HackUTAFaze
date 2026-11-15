import assert from "node:assert/strict";
import test from "node:test";
import { PRIMARY_TABS } from "./navigation";

test("Control Room exposes only Analytics and Open Contributions as primary tabs", () => {
  assert.deepEqual(
    PRIMARY_TABS.map(({ href, label }) => ({ href, label })),
    [
      { href: "/admin/control", label: "Analytics" },
      { href: "/admin/control/contributions", label: "Open Contributions" },
    ],
  );
});
