import assert from "node:assert/strict";
import test from "node:test";
import { buildUnsignedDealPackage, calculateDealEconomics, createPreparationGuard, decimalToBaseUnits, validateUnsignedDealPackage } from "./deal-package.mjs";

const validInput = {
  supplier: "0x1111111111111111111111111111111111111111",
  payer: "0x2222222222222222222222222222222222222222",
  faceValue: "100",
  requestedAdvance: "75",
  dueDate: "2026-09-01",
  nonce: "7",
  documentHash: `0x${"ab".repeat(32)}`,
  createdAtMs: Date.parse("2026-08-12T12:00:00.000Z")
};

test("deal economics exposes the immutable pre-AI upper bound", () => {
  assert.deepEqual(calculateDealEconomics("100", "75"), {
    faceValue: 100_000_000n,
    requestedAdvance: 75_000_000n,
    immutableMaximumAdvance: 80_000_000n,
    preAiUpperBound: 75_000_000n
  });
  assert.equal(calculateDealEconomics("100", "85").preAiUpperBound, 80_000_000n);
  assert.equal(decimalToBaseUnits("75.123456"), 75_123_456n);
});

test("preparation guard prevents an invalidated asynchronous result from becoming current", () => {
  const guard = createPreparationGuard();
  const firstPreparation = guard.begin();
  assert.equal(guard.isCurrent(firstPreparation), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(firstPreparation), false);
  const replacementPreparation = guard.begin();
  assert.equal(guard.isCurrent(replacementPreparation), true);
  assert.equal(guard.isCurrent(firstPreparation), false);
});

test("unsigned package is deterministic, mainnet-bound, and contains no execution authority", async () => {
  const first = await buildUnsignedDealPackage(validInput);
  const second = await buildUnsignedDealPackage(validInput);
  assert.deepEqual(first, second);
  assert.match(first.invoiceTerms.invoiceId, /^0x[0-9a-f]{64}$/);
  assert.equal(first.target.chainId, "196");
  assert.equal(first.target.verifyingContract, "0xc4Ef249b80a6a034198C226278c51b0a903840dd");
  assert.equal(first.underwritingRequest.preAiUpperBound, "75000000");
  assert.equal(first.underwritingRequest.status, "AI_ASSESSMENT_REQUIRED");
  assert.deepEqual(first.disclosures, {
    documentBytesIncluded: false,
    documentUploaded: false,
    aiAssessmentIncluded: false,
    signaturesIncluded: false,
    privateKeysIncluded: false,
    calldataIncluded: false,
    transactionAuthorized: false,
    financingPromised: false
  });
});

test("deal package fails closed on unsafe or impossible terms", async () => {
  await assert.rejects(
    () => buildUnsignedDealPackage({ ...validInput, supplier: "0x0000000000000000000000000000000000000000" }),
    /nonzero addresses/
  );
  await assert.rejects(
    () => buildUnsignedDealPackage({ ...validInput, payer: "0x0000000000000000000000000000000000000000" }),
    /nonzero addresses/
  );
  await assert.rejects(() => buildUnsignedDealPackage({ ...validInput, payer: validInput.supplier }), /must be different/);
  await assert.rejects(() => buildUnsignedDealPackage({ ...validInput, requestedAdvance: "101" }), /cannot exceed/);
  await assert.rejects(() => buildUnsignedDealPackage({ ...validInput, documentHash: "0x12" }), /32-byte/);
  await assert.rejects(() => buildUnsignedDealPackage({ ...validInput, nonce: "1.5" }), /non-negative integer/);
  await assert.rejects(() => buildUnsignedDealPackage({ ...validInput, dueDate: "2027-01-01" }), /90-day tenor/);
});

test("package review reconstructs every field and rejects coherent-looking drift", async () => {
  const valid = await buildUnsignedDealPackage(validInput);
  assert.deepEqual(await validateUnsignedDealPackage(JSON.parse(JSON.stringify(valid))), valid);
  await assert.rejects(
    () => validateUnsignedDealPackage({ ...valid, underwritingRequest: { ...valid.underwritingRequest, preAiUpperBound: "80000000" } }),
    /do not match/
  );
  await assert.rejects(
    () => validateUnsignedDealPackage({ ...valid, signature: `0x${"12".repeat(65)}` }),
    /do not match/
  );
  await assert.rejects(
    () => validateUnsignedDealPackage({ ...valid, target: { ...valid.target, chainId: "1952" } }),
    /do not match/
  );
});
