import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sourcePath = resolve(repoRoot, ".openbell/receivables-fixture-manifest.json");
const outputPath = resolve(repoRoot, "web/data/openbell-receivables-fixture.json");
const networkSourcePath = resolve(repoRoot, "evidence/openbell-xlayer-testnet-lifecycle.json");
const networkOutputPath = resolve(repoRoot, "web/data/openbell-xlayer-testnet-lifecycle.json");

const fail = (message) => {
  throw new Error(`fixture export refused: ${message}`);
};

const raw = await readFile(sourcePath, "utf8").catch(() =>
  fail("run `npm run e2e:fixture` before exporting the product proof")
);
const manifest = JSON.parse(raw);

if (manifest.schemaVersion !== "openbell-receivables-local-fixture-v1") fail("wrong schema");
if (manifest.disclosures?.localFixture !== "LOCAL FIXTURE — NO REAL VALUE") fail("local label drift");
if (manifest.disclosures?.recordedModel !== "RECORDED AI FIXTURE — NO LIVE MODEL") {
  fail("recorded-model label drift");
}
for (const boundary of ["networkTransaction", "realValue", "liveModel", "independentlyVerified"]) {
  if (manifest.disclosures?.[boundary] !== false) fail(`${boundary} must remain false`);
}
if (manifest.chain?.client !== "self-spawned Anvil") fail("local client drift");
if (manifest.chain?.explorerReceipts !== false) fail("explorer receipt boundary drift");
if (manifest.rejectedJourney?.finalStatus !== "REJECTED") fail("rejection is not terminal");
if (
  manifest.approvedJourney?.faceValue !== "100000000" ||
  manifest.approvedJourney?.requestedAdvance !== "75000000" ||
  manifest.approvedJourney?.contractMaximum !== "80000000" ||
  manifest.approvedJourney?.recordedModelMaximum !== "70000000" ||
  manifest.approvedJourney?.fundedAdvance !== "70000000" ||
  manifest.approvedJourney?.repayment !== "73500000" ||
  manifest.approvedJourney?.finalStatus !== "SETTLED"
) {
  fail("headline economics drift");
}

const visit = (value, path = "$proof") => {
  if (typeof value === "number") fail(`JSON number at ${path}`);
  if (Array.isArray(value)) return value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) visit(entry, `${path}.${key}`);
  }
};
visit(manifest);

const existing = await readFile(outputPath, "utf8").catch(() => undefined);
if (existing === undefined) {
  await writeFile(outputPath, raw);
  process.stdout.write(`Exported ${outputPath}\n`);
} else {
  const publicManifest = JSON.parse(existing);
  const allowedEntropyPaths = [
    "approvedJourney.receipts.register.blockHash",
    "approvedJourney.receipts.funderApproval.blockHash",
    "approvedJourney.receipts.fund.blockHash",
    "approvedJourney.receipts.payerApproval.blockHash",
    "approvedJourney.receipts.settle.blockHash",
    "rejectedJourney.receipts.register.blockHash",
    "rejectedJourney.receipts.reject.blockHash"
  ];
  for (const path of allowedEntropyPaths) {
    const keys = path.split(".");
    let generatedCursor = manifest;
    let publicCursor = publicManifest;
    for (const key of keys.slice(0, -1)) {
      generatedCursor = generatedCursor?.[key];
      publicCursor = publicCursor?.[key];
      if (generatedCursor === undefined || publicCursor === undefined) fail(`missing parity path ${path}`);
    }
    generatedCursor[keys.at(-1)] = "<LOCAL_BLOCK_HASH>";
    publicCursor[keys.at(-1)] = "<LOCAL_BLOCK_HASH>";
  }
  if (JSON.stringify(publicManifest) !== JSON.stringify(manifest)) fail("semantic manifest parity drift");
  process.stdout.write(`Verified semantic parity for ${outputPath}\n`);
}

const networkRaw = await readFile(networkSourcePath, "utf8");
const network = JSON.parse(networkRaw);
if (
  network.schemaVersion !== "openbell-xlayer-testnet-lifecycle-public-evidence-v1" ||
  network.label !== "XLAYER TESTNET FIXTURE — NO REAL VALUE" ||
  network.chainId !== "1952" ||
  network.transactions?.length !== 9 ||
  network.verifiedOutcome?.rejectedInvoiceStatus !== "REJECTED" ||
  network.verifiedOutcome?.rejectionZeroTokenMovement !== true ||
  network.verifiedOutcome?.approvedInvoiceStatus !== "SETTLED" ||
  network.verifiedOutcome?.funded !== "75000000" ||
  network.verifiedOutcome?.repaid !== "75750000" ||
  network.disclosures?.fixtureNoValue !== true ||
  network.disclosures?.realValue !== false ||
  network.disclosures?.privateKeysIncluded !== false ||
  network.disclosures?.signaturesIncluded !== false
) {
  fail("network lifecycle evidence boundary drift");
}
visit(network, "$networkProof");
await writeFile(networkOutputPath, networkRaw);
process.stdout.write(`Exported ${networkOutputPath}\n`);
