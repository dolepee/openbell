import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("public proof has exact semantic parity with only accepted local block-hash entropy", async () => {
  const [source, exported] = await Promise.all([
    read("../.openbell/receivables-fixture-manifest.json"),
    read("./data/openbell-receivables-fixture.json")
  ]);
  const proof = JSON.parse(source);
  const publicProof = JSON.parse(exported);
  const allowedEntropyPaths = new Set([
    "approvedJourney.receipts.register.blockHash",
    "approvedJourney.receipts.funderApproval.blockHash",
    "approvedJourney.receipts.fund.blockHash",
    "approvedJourney.receipts.payerApproval.blockHash",
    "approvedJourney.receipts.settle.blockHash",
    "rejectedJourney.receipts.register.blockHash",
    "rejectedJourney.receipts.reject.blockHash"
  ]);
  const differingPaths = [];
  const compare = (left, right, path = "") => {
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
      if (JSON.stringify(left) !== JSON.stringify(right)) differingPaths.push(path);
      return;
    }
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      compare(left[key], right[key], path ? `${path}.${key}` : key);
    }
  };
  compare(proof, publicProof);
  assert.ok(differingPaths.every((path) => allowedEntropyPaths.has(path)), differingPaths.join(","));
  for (const path of allowedEntropyPaths) {
    const keys = path.split(".");
    let sourceCursor = proof;
    let publicCursor = publicProof;
    for (const key of keys.slice(0, -1)) {
      sourceCursor = sourceCursor[key];
      publicCursor = publicCursor[key];
    }
    sourceCursor[keys.at(-1)] = "<LOCAL_BLOCK_HASH>";
    publicCursor[keys.at(-1)] = "<LOCAL_BLOCK_HASH>";
  }
  assert.deepEqual(publicProof, proof);
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

test("first-fold claims distinguish the verified network lifecycle from the recorded replay", async () => {
  const html = await read("./index.html");
  assert.match(html, /<title>OpenBell — Replay AI-bounded invoice funding<\/title>/);
  assert.match(html, /name="description"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /openbell-og\.png/);
  assert.match(html, /VERIFIED TESTNET/);
  assert.match(html, /NO REAL VALUE/);
  assert.match(html, /GENUINE AI/);
  assert.match(html, /RECORDED LOCAL REPLAY/);
  assert.match(html, /designed for bounded AI terms/);
  assert.match(html, /Genuine prior-default rejection/);
  assert.match(html, /VERIFIED TESTNET CHECKPOINT/);
  assert.match(html, /Bankr-mediated GPT-5\.6 Terra, first response/);
  assert.match(html, /APPROVE 85% · FEE 1%/);
  assert.match(html, /genuine-model lifecycle are verified on X Layer testnet/);
  assert.match(html, /min\(75 requested, 85 model, 80 contract\) = 75/);
  assert.match(html, /0x4b971ce6d7c6ae044abf7f7623c066227af145dc2e8bd8062a60aa2237bd5253/);
  assert.match(html, /0x1ea5…0036/);
  assert.match(html, /0x7E7a189a8CE288E9581Ba3CDf14ac3D4a1624703/);
  assert.match(html, /0x7eb9C2418ec935d43E6761e462eAA5388BD6ca18/);
  assert.doesNotMatch(html, /verified invoice/i);
  assert.doesNotMatch(html, /AI prices the risk/i);
  assert.doesNotMatch(html, /Prior default detected/i);
  assert.doesNotMatch(html, /AI ceiling (?:caused|determined|set) the approved amount/i);
});

test("public network evidence is exact, no-value, and signature-free", async () => {
  const [source, exported] = await Promise.all([
    read("../evidence/openbell-xlayer-testnet-lifecycle.json"),
    read("./data/openbell-xlayer-testnet-lifecycle.json")
  ]);
  assert.equal(exported, source);
  const evidence = JSON.parse(exported);
  assert.equal(evidence.label, "XLAYER TESTNET FIXTURE — NO REAL VALUE");
  assert.equal(evidence.transactions.length, 9);
  assert.equal(evidence.verifiedOutcome.rejectedInvoiceStatus, "REJECTED");
  assert.equal(evidence.verifiedOutcome.rejectionZeroTokenMovement, true);
  assert.equal(evidence.verifiedOutcome.approvedInvoiceStatus, "SETTLED");
  assert.equal(evidence.verifiedOutcome.funded, "75000000");
  assert.equal(evidence.verifiedOutcome.repaid, "75750000");
  assert.equal(evidence.disclosures.privateKeysIncluded, false);
  assert.equal(evidence.disclosures.signaturesIncluded, false);
  assert.doesNotMatch(exported, /\"privateKey\"\s*:|\"rawTransaction\"\s*:|\"signature\"\s*:/);
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
