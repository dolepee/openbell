import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("public proof is byte-identical to the accepted local fixture manifest", async () => {
  const [source, exported] = await Promise.all([
    read("../.openbell/receivables-fixture-manifest.json"),
    read("./data/openbell-receivables-fixture.json")
  ]);
  assert.equal(exported, source);
  const proof = JSON.parse(source);
  assert.equal(proof.assertions.typedDataDigestParityChecked, true);
  assert.equal(proof.assertions.expectedSignersRecovered, true);
  assert.equal(proof.assertions.rejectedPathZeroTokenMovement, true);
  assert.deepEqual(proof.rejectedJourney.exactTokenBalanceDeltas, {
    supplier: "0",
    payer: "0",
    funder: "0",
    receivables: "0"
  });
});

test("first-fold claims and metadata remain honest while the site is local", async () => {
  const html = await read("./index.html");
  assert.match(html, /<title>OpenBell — Replay AI-bounded invoice funding<\/title>/);
  assert.match(html, /name="description"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /openbell-og\.png/);
  assert.match(html, /LOCAL FIXTURE/);
  assert.match(html, /NO REAL VALUE/);
  assert.match(html, /RECORDED AI/);
  assert.match(html, /NO LIVE MODEL/);
  assert.match(html, /designed for bounded AI terms/);
  assert.match(html, /Recorded prior-default input/);
  assert.doesNotMatch(html, /verified invoice/i);
  assert.doesNotMatch(html, /AI prices the risk/i);
  assert.doesNotMatch(html, /Prior default detected/i);
  assert.doesNotMatch(html, /deployed on X Layer/i);
});

test("interactive controls use native accessible elements", async () => {
  const [html, script, css] = await Promise.all([read("./index.html"), read("./app.js"), read("./styles.css")]);
  assert.match(html, /<button[^>]+id="journey-control"/);
  assert.match(html, /<button[^>]+id="console-next"/);
  assert.match(html, /<article[^>]+class="decision-console"[^>]+tabindex="-1"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<a[^>]+href="data\/openbell-receivables-fixture\.json"/);
  assert.doesNotMatch(html, /tabindex="[1-9]/);
  assert.match(script, /addEventListener\("click"/);
  assert.match(script, /decisionConsole\.focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /proof\.disclosures\?\.independentlyVerified !== false/);
  assert.match(script, /proof\.chain\?\.client !== "self-spawned Anvil"/);
  assert.match(script, /proof\.chain\?\.explorerReceipts !== false/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
