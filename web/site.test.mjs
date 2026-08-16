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

test("multi-page launch surface separates product, deal preparation, verified cases, proof, and architecture", async () => {
  const [overview, studio, mainnet, workspace, proof, architecture] = await Promise.all([
    read("./index.html"),
    read("./studio/index.html"),
    read("./mainnet/index.html"),
    read("./workspace/index.html"),
    read("./proof/index.html"),
    read("./architecture/index.html")
  ]);
  const pages = [overview, studio, mainnet, workspace, proof, architecture];
  for (const page of pages) {
    assert.match(page, /<div class="nav-right">/);
    assert.match(page, /<nav class="desktop-nav" aria-label="Primary navigation">/);
  }
  assert.match(overview, /<title>OpenBell — AI-bounded receivables on X Layer<\/title>/);
  assert.match(overview, /One invoice\.<br \/>Three limits\.<br \/><em>Zero ambiguity\.<\/em>/);
  assert.match(overview, /min\(request, model, code\)/);
  assert.match(overview, /href="\/mainnet\/">Open live USDG desk/);
  assert.match(overview, /href="\/operate\/">Testnet desk/);
  assert.match(overview, /No mainnet lifecycle or real-value activity/);
  assert.match(studio, /BROWSER-ONLY PREPARATION/);
  assert.match(studio, /UNSIGNED PREPARATION ONLY/);
  assert.match(studio, /No transaction is constructed/);
  assert.match(studio, /AI assessment and both-party signatures happen after this boundary/);
  assert.match(mainnet, /data-network="mainnet"/);
  assert.match(mainnet, /<title>Live USDG desk — OpenBell<\/title>/);
  assert.match(mainnet, /canonical USDG on X Layer mainnet/);
  assert.match(mainnet, /rel="canonical" href="https:\/\/openbell\.dolepee\.com\/mainnet\/"/);
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
    assert.match(page, /href="\/studio\/"/);
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
  const [html, studio, operate, proof, script, dealModule, testnetModule, css] = await Promise.all([read("./workspace/index.html"), read("./studio/index.html"), read("./operate/index.html"), read("./proof/index.html"), read("./app.js"), read("./deal-package.mjs"), read("./testnet-flow.mjs"), read("./styles.css")]);
  assert.match(html, /<button[^>]+data-invoice="approved"[^>]+aria-pressed="true"/);
  assert.match(html, /<button[^>]+id="execution-next"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(proof, /<a[^>]+href="\/data\/openbell-receivables-fixture\.json"/);
  assert.match(studio, /<form class="deal-form" id="deal-form"/);
  assert.match(studio, /id="deal-face-symbol">fixture tUSDG</);
  assert.match(studio, /id="deal-request-symbol">fixture tUSDG</);
  assert.match(studio, /<input id="deal-document"[^>]+type="file"/);
  assert.match(studio, /<button[^>]+id="download-package"[^>]+disabled/);
  assert.match(operate, /XLAYER TESTNET FIXTURE/);
  assert.match(operate, /Three accounts\. One guided testnet journey\./);
  assert.match(operate, /supplier, payer, and funder addresses must be distinct/);
  assert.match(operate, /https:\/\/web3\.okx\.com\/en\/xlayer\/faucet/);
  assert.match(operate, /id="connect-wallet"[^>]+aria-pressed="false"/);
  assert.match(operate, /id="claim-fixture-tokens"[^>]+disabled[^>]+aria-busy="false"[^>]+aria-describedby="fixture-claim-help fixture-claim-error"/);
  assert.match(operate, /Funder and payer each claim 1,000 no-value fixture tUSDG/);
  assert.match(operate, /id="action-file"[^>]+aria-describedby="action-help action-error"[^>]+aria-invalid="false"/);
  assert.match(operate, /id="execute-action"[^>]+disabled[^>]+aria-busy="false"/);
  assert.match(testnetModule, /chainId: 1952/);
  assert.match(testnetModule, /chainId: 196/);
  assert.match(testnetModule, /Fixture-token claims are forbidden on mainnet/);
  assert.match(testnetModule, /recoverTypedDataAddress/);
  assert.match(studio, /<form id="review-form" class="review-import"/);
  assert.match(studio, /<input id="review-file"[^>]+type="file"[^>]+aria-describedby="review-help review-error"/);
  assert.match(studio, /id="credit-memo" hidden aria-live="polite" tabindex="-1"/);
  assert.doesNotMatch(`${html}${studio}${proof}`, /tabindex="[1-9]/);
  assert.match(script, /addEventListener\("click"/);
  assert.match(script, /proof\.disclosures\?\.independentlyVerified !== false/);
  assert.match(script, /proof\.chain\?\.client !== "self-spawned Anvil"/);
  assert.match(script, /proof\.chain\?\.explorerReceipts !== false/);
  assert.match(script, /network\.verifiedOutcome\?\.approvedInvoiceStatus !== "SETTLED"/);
  assert.match(dealModule, /openbell-receivables-deal-preparation-v1/);
  assert.match(dealModule, /documentUploaded: false/);
  assert.match(dealModule, /transactionAuthorized: false/);
  assert.match(dealModule, /validateUnsignedDealPackage/);
  assert.match(dealModule, /export const createPreparationGuard/);
  assert.match(dealModule, /Supplier and payer must be nonzero addresses/);
  assert.match(script, /const invalidatePreparedPackage = \(\) =>/);
  assert.match(script, /const symbol = dealPackage\.target\.settlementTokenSymbol/);
  assert.match(script, /targetInput\.addEventListener\("input", renderTargetLabels\)/);
  assert.match(script, /requestedTarget === "mainnet" \|\| requestedTarget === "testnet"/);
  assert.match(script, /const studioOperationGuard = createPreparationGuard\(\)/);
  assert.match(script, /studioOperationGuard\.invalidate\(\)/);
  assert.match(script, /const preparationRevision = studioOperationGuard\.begin\(\)/);
  assert.match(script, /if \(!studioOperationGuard\.isCurrent\(preparationRevision\)\) return/);
  assert.match(script, /\[supplierInput, payerInput, dueInput, nonceInput, documentHashInput, targetInput\]/);
  assert.match(script, /documentInput\.addEventListener\("change", invalidatePreparedPackage\)/);
  assert.match(script, /consentInput\.addEventListener\("change", invalidatePreparedPackage\)/);
  assert.match(script, /reviewFile\.setAttribute\("aria-invalid", "false"\);\s+clearCreditMemo\(\);/);
  assert.match(script, /reviewFile\.addEventListener\("change"/);
  assert.match(script, /const reviewRevision = studioOperationGuard\.begin\(\)/);
  assert.match(script, /if \(!studioOperationGuard\.isCurrent\(reviewRevision\)\) return/);
  assert.doesNotMatch(script, /const (?:preparation|review)Guard =/);
  assert.match(script, /reviewFile\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /prefers-reduced-motion/);
});
