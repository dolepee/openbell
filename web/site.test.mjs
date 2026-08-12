import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { expectedMainnetEvidence, validateMainnetPublicEvidence } from "../scripts/lib/mainnet-public-evidence.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("public proof has exact semantic parity with only accepted local block-hash entropy", async () => {
  const [source, exported] = await Promise.all([
    read("../.openbell/receivables-fixture-manifest.json"),
    read("./data/openbell-receivables-fixture.json")
  ]);
  const proof = JSON.parse(source);
  const publicProof = JSON.parse(exported);
  const allowedEntropyPaths = new Set([
    "contracts.deploymentReceipts.token.blockHash",
    "contracts.deploymentReceipts.receivables.blockHash",
    "fixtureFunding.funderClaim.blockHash",
    "fixtureFunding.payerClaim.blockHash",
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

test("multi-page launch surface separates product, workspace, proof, and architecture", async () => {
  const [overview, workspace, proof, architecture] = await Promise.all([
    read("./index.html"),
    read("./workspace/index.html"),
    read("./proof/index.html"),
    read("./architecture/index.html")
  ]);
  const pages = [overview, workspace, proof, architecture];
  assert.match(overview, /<title>OpenBell — AI-bounded receivables on X Layer<\/title>/);
  assert.match(overview, /One invoice\.<br \/>Three limits\.<br \/><em>Zero ambiguity\.<\/em>/);
  assert.match(overview, /min\(request, model, code\)/);
  assert.match(overview, /No mainnet lifecycle or real-value activity/);
  assert.match(workspace, /Bankr-mediated GPT-5\.6 Terra · first response/);
  assert.match(workspace, /data-invoice="approved"/);
  assert.match(workspace, /data-invoice="rejected"/);
  assert.match(proof, /0xc4Ef249b80a6a034198C226278c51b0a903840dd/);
  assert.match(proof, /0x328c80d5…f413e/);
  assert.match(proof, /0x3aa05fd1a2f966e99324c8c24dc3ee67e2f4c11a4f3c8de0da25fc1f7e8a9798/);
  assert.match(proof, /0xac31d5ee9c4474c6233ad141a436115d439bda8599dc9680852b6ffe4371f020/);
  assert.match(proof, /d5b69eb5e453fd691e7d9265ed7ce14ef81b2b19fb9ed1bf50dd4ac80670eec8/);
  assert.match(proof, /0x4b971ce6d7c6ae044abf7f7623c066227af145dc2e8bd8062a60aa2237bd5253/);
  assert.match(proof, /0x1ea5…0036/);
  assert.match(proof, /Independent\/explorer source verification false/);
  assert.match(proof, /RECORDED AI/);
  assert.match(proof, /NO LIVE MODEL/);
  assert.match(architecture, /AI proposes.<br \/>The contract disposes/);
  assert.match(architecture, /MIN\(REQUEST, AI, CODE\)/);
  for (const page of pages) {
    assert.match(page, /name="description"/);
    assert.match(page, /name="robots" content="index, follow"/);
    assert.match(page, /rel="canonical" href="https:\/\/openbell\.dolepee\.com\//);
    assert.match(page, /property="og:url" content="https:\/\/openbell\.dolepee\.com\//);
    assert.match(page, /property="og:image" content="https:\/\/openbell\.dolepee\.com\/public\/openbell-og\.png"/);
    assert.match(page, /name="twitter:image" content="https:\/\/openbell\.dolepee\.com\/public\/openbell-og\.png"/);
    assert.match(page, /href="\/workspace\/"/);
    assert.match(page, /href="\/proof\/"/);
    assert.match(page, /href="\/architecture\/"/);
    assert.doesNotMatch(page, /verified invoice/i);
    assert.doesNotMatch(page, /AI prices the risk/i);
    assert.doesNotMatch(page, /Prior default detected/i);
    assert.doesNotMatch(page, /AI ceiling (?:caused|determined|set) the approved amount/i);
  }
});

test("public mainnet deployment evidence is exact, minimal, and private-material free", async () => {
  const [source, exported, publicRecord, deterministicVerification] = await Promise.all([
    read("../evidence/openbell-xlayer-mainnet-deployment.json"),
    read("./data/openbell-xlayer-mainnet-deployment.json"),
    read("../evidence/openbell-xlayer-mainnet-verification-record.json"),
    read("../evidence/openbell-xlayer-mainnet-observation-verification.json")
  ]);
  assert.equal(exported, source);
  const evidence = JSON.parse(exported);
  assert.deepEqual(evidence, expectedMainnetEvidence);
  assert.deepEqual(validateMainnetPublicEvidence({
    evidence,
    exportedEvidence: JSON.parse(source),
    publicRecordBytes: publicRecord,
    deterministicVerificationBytes: deterministicVerification
  }), { publicRecordHash: "0xd5b69eb5e453fd691e7d9265ed7ce14ef81b2b19fb9ed1bf50dd4ac80670eec8" });
  assert.doesNotMatch(exported, /\/Users\/|"privateKey"\s*:|"signedTransaction"\s*:|rpc\.xlayer|xlayerrpc|"credential"\s*:/i);
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
  const [html, proof, script, css] = await Promise.all([read("./workspace/index.html"), read("./proof/index.html"), read("./app.js"), read("./styles.css")]);
  assert.match(html, /<button[^>]+data-invoice="approved"[^>]+aria-pressed="true"/);
  assert.match(html, /<button[^>]+id="execution-next"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(proof, /<a[^>]+href="\/data\/openbell-receivables-fixture\.json"/);
  assert.doesNotMatch(`${html}${proof}`, /tabindex="[1-9]/);
  assert.match(script, /addEventListener\("click"/);
  assert.match(script, /proof\.disclosures\?\.independentlyVerified !== false/);
  assert.match(script, /proof\.chain\?\.client !== "self-spawned Anvil"/);
  assert.match(script, /proof\.chain\?\.explorerReceipts !== false/);
  assert.match(script, /network\.verifiedOutcome\?\.approvedInvoiceStatus !== "SETTLED"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
