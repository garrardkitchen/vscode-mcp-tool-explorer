import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonDocument, renderColouredJson } from "../src/view/jsonDoc.js";

test("colours an object and records a path for each value", () => {
  const html = renderColouredJson({
    mail: "ada@example.com",
    proxyAddresses: ["smtp:ada@example.com"],
    "a.b": 1,
    active: true,
    nickname: null,
  });

  assert.match(html, /class="k json-hit" data-path="\$\.mail"/);
  assert.match(html, /class="s json-hit" data-path="\$\.mail"/);
  assert.match(html, /ada@example\.com/);
  assert.match(html, /data-path="\$\.proxyAddresses\[0\]"/);
  assert.match(html, /data-path="\$\[&quot;a\.b&quot;\]"/);
  assert.match(html, /class="n json-hit"/);
  assert.match(html, /class="b json-hit"/);
  assert.match(html, />true</);
  assert.match(html, /class="z json-hit"/);
  assert.match(html, />null</);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /style="/);
});

test("escapes text that would break the page and leaves other text plain", () => {
  const value = parseJsonDocument('{"note":"<script>alert(1)</script>"}');
  assert.ok(value);
  const html = renderColouredJson(value);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);

  assert.equal(parseJsonDocument("not json"), undefined);
  assert.equal(parseJsonDocument("\"just a string\""), undefined);
  assert.equal(parseJsonDocument("null"), undefined);
  assert.deepEqual(parseJsonDocument("  []"), []);
  assert.match(renderColouredJson({}), />\{\}</);
  assert.match(renderColouredJson([]), />\[\]</);
});

test("puts a comma after a nested object", () => {
  const html = renderColouredJson({ user: { mail: "a@b" }, n: 2 });
  assert.match(html, /class="p">\}<\/span><span class="p">,<\/span>/);
  assert.match(html, /data-path="\$\.user\.mail"/);
  assert.match(html, /data-path="\$\.n"/);
});
