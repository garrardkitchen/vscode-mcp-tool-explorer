import assert from "node:assert/strict";
import test from "node:test";
import { compareTools } from "../src/catalog.js";

test("sorts tools alphabetically by the name shown in the list", () => {
  const tools = [
    { name: "zeta", title: "Zebra" },
    { name: "middle" },
    { name: "alpha" },
    { name: "AlphaTool", title: "alpha" },
    { name: "beta" },
  ];
  tools.sort(compareTools);
  assert.deepEqual(tools.map((tool) => tool.name), ["alpha", "AlphaTool", "beta", "middle", "zeta"]);
});
