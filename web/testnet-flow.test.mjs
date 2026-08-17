import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  OPENBELL_TESTNET,
  FIXTURE_CLAIM_AMOUNT,
  approvalTypedData,
  addInvoiceSessionSignature,
  assertActionAgainstInvoice,
  assertFixtureClaimAvailable,
  assertFixtureClaimCompleted,
  assertWalletContext,
  buildBrowserBankrRequestHash,
  buildFixtureClaimStateCalls,
  buildConnectedAssessmentRequest,
  connectedDecisionTypedData,
  connectedAssessmentTypedData,
  createFixtureClaimAction,
  invoiceTypedData,
  createInvoiceSession,
  finalizeConnectedAssessment,
  fixtureClaimPackage,
  rejectionTypedData,
  registrationActionFromSession,
  walletInvoiceTypedData,
  walletConnectedAssessmentTypedData,
  validateBrowserAction,
  validateConnectedPolicyRefusal
} from "./testnet-flow.mjs";
import { OPENBELL_TESTNET_TARGET, buildUnsignedDealPackage } from "./deal-package.mjs";

const supplier = privateKeyToAccount(`0x${"11".repeat(32)}`);
const payer = privateKeyToAccount(`0x${"22".repeat(32)}`);
const funder = privateKeyToAccount(`0x${"33".repeat(32)}`);
const underwriter = privateKeyToAccount(`0x${"44".repeat(32)}`);
const terms = {
  invoiceId: `0x${"aa".repeat(32)}`,
  documentHash: `0x${"bb".repeat(32)}`,
  supplier: supplier.address,
  payer: payer.address,
  faceValue: "100000000",
  issuedAt: "1786550000",
  dueDate: "1789142000",
  nonce: "7"
};
const approval = {
  invoiceId: terms.invoiceId,
  invoiceDigest: `0x${"cc".repeat(32)}`,
  funder: funder.address,
  advanceAmount: "75000000",
  repaymentAmount: "75750000",
  riskTimestamp: "1786550100",
  expiresAt: "1786553700",
  riskReasonsHash: `0x${"dd".repeat(32)}`,
  modelHash: `0x${"ee".repeat(32)}`,
  nonce: "9"
};

const assessment = {
  decision: { verdict: "APPROVE", ...approval, nonce: undefined, riskTimestamp: Number(approval.riskTimestamp), expiresAt: Number(approval.expiresAt), reasons: ["LIMITED_PAYER_HISTORY"], explanation: "The supplied synthetic evidence supports approval within the returned structured limits.", modelId: "bankr:gpt-5.6-terra:receipt:test" },
  modelEvidence: { provider: "bankr-chat-completions", decision: { verdict: "APPROVE" } },
  observation: { invoiceId: terms.invoiceId, supplier: supplier.address, payer: payer.address, underwriter: underwriter.address },
  signingRequest: { schemaVersion: "openbell-connected-decision-signing-v1", label: OPENBELL_TESTNET.label, chainId: "1952", underwriter: underwriter.address, authorizedDigest: "", nonce: approval.nonce }
};
delete assessment.decision.nonce;

const policyRefusal = {
  schemaVersion: "openbell-connected-policy-refusal-v1",
  outcome: "POLICY_REFUSAL",
  executionAuthority: false,
  refusal: { code: "LOW_CONFIDENCE", message: "The model confidence is below the policy floor." },
  modelEvidence: {
    provider: "bankr-chat-completions",
    providerResponseId: "response-test-1",
    requestedModel: "gpt-5.6-terra",
    returnedModel: "gpt-5.6-terra",
    requestHash: `0x${"12".repeat(32)}`,
    responseHash: `0x${"13".repeat(32)}`,
    decision: { verdict: "APPROVE", maximumAdvanceBps: 7000, feeBps: 100, confidenceBps: 6500, reasons: ["MODEL_UNCERTAINTY"], explanation: "The supplied synthetic evidence supports approval within the returned structured limits." }
  },
  observation: {
    chainId: 1952,
    receivables: OPENBELL_TESTNET.receivables,
    settlementToken: OPENBELL_TESTNET.settlementToken,
    blockNumber: "12345",
    blockHash: `0x${"14".repeat(32)}`,
    blockTimestamp: 1786550200,
    registrationTransactionHash: `0x${"15".repeat(32)}`,
    status: "REGISTERED",
    invoiceId: terms.invoiceId,
    invoiceDigest: approval.invoiceDigest,
    documentHash: terms.documentHash,
    supplier: supplier.address,
    payer: payer.address,
    faceValue: terms.faceValue,
    issuedAt: Number(terms.issuedAt),
    dueDate: Number(terms.dueDate),
    underwriter: underwriter.address,
    paused: false,
    decisionNonceUnused: true,
    documentHashRegistered: true,
    invoiceDigestRegistered: true
  }
};
const policyRefusalRequest = {
  schemaVersion: "openbell-connected-underwriting-v1",
  label: OPENBELL_TESTNET.label,
  registrationTransactionHash: policyRefusal.observation.registrationTransactionHash,
  invoiceId: policyRefusal.observation.invoiceId,
  documentHash: policyRefusal.observation.documentHash,
  supplier: policyRefusal.observation.supplier,
  payer: policyRefusal.observation.payer,
  faceValue: policyRefusal.observation.faceValue,
  issuedAt: policyRefusal.observation.issuedAt,
  dueDate: policyRefusal.observation.dueDate,
  funder: funder.address,
  requestedAdvance: "75000000",
  payerHistory: { completedSettlements: 0, onTimeSettlements: 0, lateSettlements: 0, defaults: 0, concentrationBps: 0, daysSinceLastSettlement: 0 },
  redactedContext: "Synthetic X Layer testnet fixture; no real value."
};
const refusalModelInput = (refusal, request) => ({
  invoiceId: refusal.observation.invoiceId,
  invoiceDigest: refusal.observation.invoiceDigest,
  supplier: refusal.observation.supplier,
  payer: refusal.observation.payer,
  funder: request.funder,
  faceValue: refusal.observation.faceValue,
  issuedAt: refusal.observation.issuedAt,
  dueDate: refusal.observation.dueDate,
  requestedAdvance: request.requestedAdvance,
  evidence: { supplierSignatureValid: true, payerSignatureValid: true, duplicateInvoiceFound: false, documentHashMatches: true },
  payerHistory: request.payerHistory,
  redactedContext: request.redactedContext
});
policyRefusal.modelEvidence.requestHash = buildBrowserBankrRequestHash(refusalModelInput(policyRefusal, policyRefusalRequest), "synthetic");

test("policy refusals preserve evidence without exposing execution authority", () => {
  assert.equal(validateConnectedPolicyRefusal(policyRefusal, policyRefusalRequest), policyRefusal);
  assert.equal("signingRequest" in policyRefusal, false);
  assert.throws(() => validateConnectedPolicyRefusal({ ...policyRefusal, executionAuthority: true }, policyRefusalRequest), /no execution authority/);
  assert.throws(() => validateConnectedPolicyRefusal({ ...policyRefusal, signingRequest: {} }, policyRefusalRequest), /unsupported or missing fields/);
  assert.throws(() => validateConnectedPolicyRefusal({
    ...policyRefusal,
    modelEvidence: { ...policyRefusal.modelEvidence, decision: { ...policyRefusal.modelEvidence.decision, verdict: "REJECT" } }
  }, policyRefusalRequest), /contradicts the model decision/);
  assert.throws(() => validateConnectedPolicyRefusal({
    ...policyRefusal,
    modelEvidence: { ...policyRefusal.modelEvidence, decision: { ...policyRefusal.modelEvidence.decision, confidenceBps: 7_000 } }
  }, policyRefusalRequest), /contradicts the model decision/);
  assert.throws(() => validateConnectedPolicyRefusal({
    ...policyRefusal,
    refusal: { ...policyRefusal.refusal, message: "A different refusal explanation." }
  }, policyRefusalRequest), /contradicts the model decision/);
  for (const [code, message] of [
    ["INVALID_EVIDENCE", "Both signatures and the document hash must verify."],
    ["DUPLICATE_INVOICE", "The invoice already appears in the duplicate index."],
    ["INVALID_TENOR", "The invoice tenor is outside the protocol envelope."]
  ]) {
    assert.throws(() => validateConnectedPolicyRefusal({ ...policyRefusal, refusal: { code, message } }, policyRefusalRequest), /reason is invalid/);
  }
  assert.throws(() => validateConnectedPolicyRefusal({
    ...policyRefusal,
    refusal: { code: "MODEL_REJECTED", message: "The bounded advance is zero." },
    modelEvidence: {
      ...policyRefusal.modelEvidence,
      decision: { ...policyRefusal.modelEvidence.decision, confidenceBps: 8_000, maximumAdvanceBps: 1 }
    }
  }, policyRefusalRequest), /contradicts the model decision/);
  assert.throws(() => validateConnectedPolicyRefusal(policyRefusal), /exact submitted assessment request/);
  assert.throws(() => validateConnectedPolicyRefusal(policyRefusal, { ...policyRefusalRequest, invoiceId: `0x${"ff".repeat(32)}` }), /does not match/);
  for (const changedRequest of [
    { ...policyRefusalRequest, funder: underwriter.address },
    { ...policyRefusalRequest, requestedAdvance: "74000000" },
    { ...policyRefusalRequest, payerHistory: { ...policyRefusalRequest.payerHistory, daysSinceLastSettlement: 1 } },
    { ...policyRefusalRequest, redactedContext: "Different authorized context." }
  ]) {
    assert.throws(() => validateConnectedPolicyRefusal(policyRefusal, changedRequest), /model request hash does not match/);
  }
  assert.throws(() => validateConnectedPolicyRefusal({
    ...policyRefusal,
    modelEvidence: {
      ...policyRefusal.modelEvidence,
      decision: { ...policyRefusal.modelEvidence.decision, explanation: "A noncanonical but nonempty explanation." }
    }
  }, policyRefusalRequest), /explanation does not match/);
  const roundedRefusal = {
    ...policyRefusal,
    refusal: { code: "MODEL_REJECTED", message: "The bounded advance is zero." },
    modelEvidence: {
      ...policyRefusal.modelEvidence,
      decision: { ...policyRefusal.modelEvidence.decision, confidenceBps: 8_000, maximumAdvanceBps: 1 }
    },
    observation: { ...policyRefusal.observation, faceValue: "1" }
  };
  const roundedRequest = { ...policyRefusalRequest, faceValue: "1" };
  roundedRefusal.modelEvidence.requestHash = buildBrowserBankrRequestHash(refusalModelInput(roundedRefusal, roundedRequest), "synthetic");
  assert.equal(validateConnectedPolicyRefusal(roundedRefusal, roundedRequest), roundedRefusal);
});

const wrap = (kind, signer, authorizedDigest, payload) => ({
  schemaVersion: "openbell-testnet-browser-action-v1",
  label: OPENBELL_TESTNET.label,
  chainId: "1952",
  kind,
  signer,
  authorizedDigest,
  payload
});

test("registration requires exact numeric-domain digest and both genuine party signatures", async () => {
  const typedData = invoiceTypedData(terms);
  assert.equal(typedData.domain.chainId, 1952);
  const authorizedDigest = await supplier.signTypedData(typedData).then(async (signature) => {
    const payerSignature = await payer.signTypedData(typedData);
    const action = await validateBrowserAction(wrap("REGISTER_INVOICE", supplier.address, await supplier.signTypedData(typedData).then(() => import("viem").then(({ hashTypedData }) => hashTypedData(typedData))), {
      terms,
      supplierSignature: signature,
      payerSignature
    }));
    assert.equal(action.to, OPENBELL_TESTNET.receivables);
    assert.equal(action.signer, supplier.address);
    assert.equal(action.value, 0n);
    return action;
  });
  assert.equal(authorizedDigest.kind, "REGISTER_INVOICE");
});

test("string chainId produces a different digest and is rejected", async () => {
  const numeric = invoiceTypedData(terms);
  const stringDomain = { ...numeric, domain: { ...numeric.domain, chainId: "1952" } };
  const { hashTypedData } = await import("viem");
  const wrongDigest = hashTypedData(stringDomain);
  const supplierSignature = await supplier.signTypedData(numeric);
  const payerSignature = await payer.signTypedData(numeric);
  await assert.rejects(
    validateBrowserAction(wrap("REGISTER_INVOICE", supplier.address, wrongDigest, { terms, supplierSignature, payerSignature })),
    /digest does not match/
  );
});

test("wallet signing payload declares the complete numeric EIP-712 domain", () => {
  const typedData = walletInvoiceTypedData(terms);
  assert.equal(typedData.domain.chainId, 1952);
  assert.deepEqual(typedData.types.EIP712Domain.map(({ name }) => name), ["name", "version", "chainId", "verifyingContract"]);
});

test("wrong signer, altered amount, and wrong wallet context fail closed", async () => {
  const typedData = approvalTypedData(approval);
  const { hashTypedData } = await import("viem");
  const authorizedDigest = hashTypedData(typedData);
  const underwriterSignature = await underwriter.signTypedData(typedData);
  const valid = wrap("FUND_INVOICE", funder.address, authorizedDigest, { approval, underwriter: underwriter.address, underwriterSignature });
  const action = await validateBrowserAction(valid);
  assert.equal(action.amount, 75_000_000n);
  assert.throws(() => assertWalletContext(action, { account: payer.address, chainId: 1952 }), /required signer/);
  assert.throws(() => assertWalletContext(action, { account: funder.address, chainId: 196 }), /chain 1952/);
  await assert.rejects(
    validateBrowserAction({ ...valid, payload: { ...valid.payload, approval: { ...approval, advanceAmount: "76000000" } } }),
    /digest does not match/
  );
});

test("an explicit underwriter wallet signature finalizes exact connected actions", async () => {
  const { hashTypedData } = await import("viem");
  const typedData = approvalTypedData(approval);
  const candidate = { ...assessment, signingRequest: { ...assessment.signingRequest, authorizedDigest: hashTypedData(typedData) } };
  const walletTypedData = connectedDecisionTypedData(candidate);
  assert.equal(walletTypedData.domain.chainId, 1952);
  const underwriterSignature = await underwriter.signTypedData(typedData);
  const actions = await finalizeConnectedAssessment(candidate, underwriterSignature);
  assert.deepEqual(actions.map(({ kind }) => kind), ["APPROVE_FUNDING", "FUND_INVOICE", "APPROVE_SETTLEMENT", "SETTLE_INVOICE"]);
});

test("connected decision finalization rejects wrong signer and changed decision digest", async () => {
  const { hashTypedData } = await import("viem");
  const typedData = approvalTypedData(approval);
  const candidate = { ...assessment, signingRequest: { ...assessment.signingRequest, authorizedDigest: hashTypedData(typedData) } };
  await assert.rejects(finalizeConnectedAssessment(candidate, await payer.signTypedData(typedData)), /wrong signer/);
  assert.throws(() => connectedDecisionTypedData({ ...candidate, decision: { ...candidate.decision, advanceAmount: "74000000" } }), /digest changed/);
  assert.throws(() => connectedDecisionTypedData({ ...candidate, signingRequest: { ...candidate.signingRequest, chainId: 1952 } }), /Unsupported decision signing request/);
  const canonical = await underwriter.signTypedData(typedData);
  const s = BigInt(`0x${canonical.slice(66, 130)}`);
  const v = Number.parseInt(canonical.slice(130, 132), 16);
  const highS = (0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n - s).toString(16).padStart(64, "0");
  const malleated = `${canonical.slice(0, 66)}${highS}${v === 27 ? "1c" : "1b"}`;
  await assert.rejects(finalizeConnectedAssessment(candidate, malleated), /canonical low-s ECDSA/);
});

test("rejection recovers only the declared underwriter", async () => {
  const rejection = {
    invoiceId: terms.invoiceId,
    invoiceDigest: approval.invoiceDigest,
    riskTimestamp: approval.riskTimestamp,
    expiresAt: approval.expiresAt,
    riskReasonsHash: approval.riskReasonsHash,
    modelHash: approval.modelHash,
    nonce: "10"
  };
  const typedData = rejectionTypedData(rejection);
  const { hashTypedData } = await import("viem");
  const digest = hashTypedData(typedData);
  const underwriterSignature = await underwriter.signTypedData(typedData);
  const action = await validateBrowserAction(wrap("ATTEST_REJECTION", supplier.address, digest, { rejection, underwriter: underwriter.address, underwriterSignature }));
  assert.equal(action.kind, "ATTEST_REJECTION");
  await assert.rejects(
    validateBrowserAction(wrap("ATTEST_REJECTION", supplier.address, digest, { rejection, underwriter: payer.address, underwriterSignature })),
    /wrong signer/
  );
});

test("token approvals and settlement reconstruct fixed contract calls without arbitrary targets", async () => {
  const { hashTypedData } = await import("viem");
  const typedData = approvalTypedData(approval);
  const fundingApproval = await validateBrowserAction(wrap("APPROVE_FUNDING", funder.address, hashTypedData(typedData), { approval, underwriter: underwriter.address, underwriterSignature: await underwriter.signTypedData(typedData) }));
  assert.equal(fundingApproval.to, OPENBELL_TESTNET.settlementToken);
  assert.equal(fundingApproval.value, 0n);
  await assert.rejects(
    validateBrowserAction(wrap("APPROVE_FUNDING", payer.address, hashTypedData(typedData), { approval, underwriter: underwriter.address, underwriterSignature: await underwriter.signTypedData(typedData) })),
    /bound funder/
  );
  const settlement = await validateBrowserAction(wrap("SETTLE_INVOICE", payer.address, null, { invoiceId: terms.invoiceId, repaymentAmount: "75750000" }));
  assert.equal(settlement.to, OPENBELL_TESTNET.receivables);
  await assert.rejects(
    validateBrowserAction({ ...wrap("SETTLE_INVOICE", payer.address, null, { invoiceId: terms.invoiceId, repaymentAmount: "75750000" }), to: payer.address }),
    /unsupported or missing fields/
  );
});

test("fixture-token claim reconstructs one fixed zero-value token call", async () => {
  const { encodeFunctionData } = await import("viem");
  const action = await createFixtureClaimAction(funder.address);
  assert.equal(action.kind, "CLAIM_FIXTURE_TOKENS");
  assert.equal(action.signer, funder.address);
  assert.equal(action.to, OPENBELL_TESTNET.settlementToken);
  assert.equal(action.value, 0n);
  assert.equal(action.amount, FIXTURE_CLAIM_AMOUNT);
  assert.equal(action.invoiceId, null);
  assert.equal(action.authorizedDigest, undefined);
  assert.equal(action.data, encodeFunctionData({ abi: [{ type: "function", name: "claimFixtureTokens", stateMutability: "nonpayable", inputs: [], outputs: [] }], functionName: "claimFixtureTokens" }));
  assert.throws(() => assertWalletContext(action, { account: payer.address, chainId: 1952 }), /required signer/);
  assert.throws(() => assertWalletContext(action, { account: funder.address, chainId: 196 }), /chain 1952/);
  await assert.rejects(validateBrowserAction({ ...fixtureClaimPackage(funder.address), chainId: "196" }), /wrong chain/);
  await assert.rejects(validateBrowserAction({ ...fixtureClaimPackage(funder.address), to: payer.address }), /unsupported or missing fields/);
  await assert.rejects(validateBrowserAction({ ...fixtureClaimPackage(funder.address), authorizedDigest: `0x${"aa".repeat(32)}` }), /cannot carry/);
  await assert.rejects(validateBrowserAction({ ...fixtureClaimPackage(funder.address), payload: { target: payer.address } }), /unsupported or missing fields/);
  assert.throws(() => fixtureClaimPackage("0x0000000000000000000000000000000000000000"), /must be nonzero/);
});

test("fixture-token claim binds preflight state and confirmed balance increase", async () => {
  const { encodeFunctionResult } = await import("viem");
  const action = await createFixtureClaimAction(payer.address);
  const calls = buildFixtureClaimStateCalls(payer.address);
  assert.match(calls.hasClaimed, /^0x[0-9a-f]+$/i);
  assert.match(calls.balance, /^0x[0-9a-f]+$/i);
  assert.match(calls.faucetAmount, /^0x[0-9a-f]+$/i);
  const boolAbi = [{ type: "function", name: "hasClaimed", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] }];
  const balanceAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }];
  const amountAbi = [{ type: "function", name: "FAUCET_AMOUNT", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }];
  const encodeClaimed = (value) => encodeFunctionResult({ abi: boolAbi, functionName: "hasClaimed", result: value });
  const encodeBalance = (value) => encodeFunctionResult({ abi: balanceAbi, functionName: "balanceOf", result: value });
  const encodeAmount = (value) => encodeFunctionResult({ abi: amountAbi, functionName: "FAUCET_AMOUNT", result: value });
  const available = assertFixtureClaimAvailable(action, {
    hasClaimedResult: encodeClaimed(false),
    balanceResult: encodeBalance(25_000_000n),
    faucetAmountResult: encodeAmount(FIXTURE_CLAIM_AMOUNT)
  });
  assert.equal(available.balance, 25_000_000n);
  assert.throws(() => assertFixtureClaimAvailable(action, {
    hasClaimedResult: encodeClaimed(true),
    balanceResult: encodeBalance(25_000_000n),
    faucetAmountResult: encodeAmount(FIXTURE_CLAIM_AMOUNT)
  }), /already claimed/);
  assert.throws(() => assertFixtureClaimAvailable(action, {
    hasClaimedResult: encodeClaimed(false),
    balanceResult: encodeBalance(25_000_000n),
    faucetAmountResult: encodeAmount(999_000_000n)
  }), /amount changed/);
  const completed = assertFixtureClaimCompleted(action, {
    hasClaimedResult: encodeClaimed(true),
    balanceResult: encodeBalance(1_025_000_000n)
  }, available.balance);
  assert.equal(completed.balance, 1_025_000_000n);
  assert.throws(() => assertFixtureClaimCompleted(action, {
    hasClaimedResult: encodeClaimed(false),
    balanceResult: encodeBalance(1_025_000_000n)
  }, available.balance), /flag was not set/);
  assert.throws(() => assertFixtureClaimCompleted(action, {
    hasClaimedResult: encodeClaimed(true),
    balanceResult: encodeBalance(1_024_999_999n)
  }, available.balance), /did not increase by exactly/);
  assert.throws(() => assertFixtureClaimCompleted(action, {
    hasClaimedResult: encodeClaimed(true),
    balanceResult: encodeBalance(1_025_000_001n)
  }, available.balance), /did not increase by exactly/);
});

test("onchain invoice state binds role, amount, status, digest, and expiry", async () => {
  const { encodeFunctionResult, hashTypedData } = await import("viem");
  const typedData = approvalTypedData(approval);
  const action = await validateBrowserAction(wrap("FUND_INVOICE", funder.address, hashTypedData(typedData), {
    approval,
    underwriter: underwriter.address,
    underwriterSignature: await underwriter.signTypedData(typedData)
  }));
  const result = encodeFunctionResult({
    abi: [{ type: "function", name: "invoices", stateMutability: "view", inputs: [{ name: "invoiceId", type: "bytes32" }], outputs: [
      { name: "status", type: "uint8" }, { name: "supplier", type: "address" }, { name: "payer", type: "address" }, { name: "funder", type: "address" },
      { name: "faceValue", type: "uint128" }, { name: "advanceAmount", type: "uint128" }, { name: "repaymentAmount", type: "uint128" }, { name: "dueDate", type: "uint64" },
      { name: "documentHash", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" }, { name: "decisionDigest", type: "bytes32" }
    ] }],
    functionName: "invoices",
    result: [1, supplier.address, payer.address, "0x0000000000000000000000000000000000000000", 100_000_000n, 0n, 0n, 1_789_142_000n, terms.documentHash, approval.invoiceDigest, `0x${"00".repeat(32)}`]
  });
  assert.equal(assertActionAgainstInvoice(action, result, 1_786_550_200).status, 1);
  assert.throws(() => assertActionAgainstInvoice(action, result, 1_786_553_701), /expired/);
  const alteredDigestResult = result.replace(approval.invoiceDigest.slice(2), "ff".repeat(32));
  assert.throws(() => assertActionAgainstInvoice(action, alteredDigestResult, 1_786_550_200), /digest differs/);
});

test("supplier and payer can complete a browser-only registration handoff", async () => {
  const dealPackage = await buildUnsignedDealPackage({
    supplier: supplier.address,
    payer: payer.address,
    faceValue: "100",
    requestedAdvance: "75",
    dueDate: "2026-09-01",
    nonce: "7",
    documentHash: terms.documentHash,
    createdAtMs: Date.parse("2026-08-13T12:00:00.000Z"),
    target: OPENBELL_TESTNET_TARGET
  });
  const empty = await createInvoiceSession(dealPackage);
  const supplierSigned = await addInvoiceSessionSignature(empty, supplier.address, await supplier.signTypedData(invoiceTypedData(dealPackage.invoiceTerms)));
  assert.equal(supplierSigned.payerSignature, null);
  await assert.rejects(() => registrationActionFromSession(supplierSigned), /Both invoice signatures/);
  const complete = await addInvoiceSessionSignature(supplierSigned, payer.address, await payer.signTypedData(invoiceTypedData(dealPackage.invoiceTerms)));
  const registration = await registrationActionFromSession(complete);
  assert.equal(registration.kind, "REGISTER_INVOICE");
  assert.equal((await validateBrowserAction(registration)).signer, supplier.address);
  await assert.rejects(() => addInvoiceSessionSignature(empty, funder.address, `0x${"11".repeat(65)}`), /neither the supplier nor the payer/);
});

test("supplier assessment authority binds the confirmed registration, funder and evidence", async () => {
  const dealPackage = await buildUnsignedDealPackage({
    supplier: supplier.address,
    payer: payer.address,
    faceValue: "100",
    requestedAdvance: "75",
    dueDate: "2026-09-01",
    nonce: "7",
    documentHash: terms.documentHash,
    createdAtMs: Date.parse("2026-08-13T12:00:00.000Z"),
    target: OPENBELL_TESTNET_TARGET
  });
  let session = await createInvoiceSession(dealPackage);
  session = await addInvoiceSessionSignature(session, supplier.address, await supplier.signTypedData(invoiceTypedData(dealPackage.invoiceTerms)));
  session = await addInvoiceSessionSignature(session, payer.address, await payer.signTypedData(invoiceTypedData(dealPackage.invoiceTerms)));
  const unsigned = await buildConnectedAssessmentRequest({
    session,
    registrationTransactionHash: `0x${"12".repeat(32)}`,
    funder: funder.address,
    payerHistory: { completedSettlements: 0, onTimeSettlements: 0, lateSettlements: 0, defaults: 0, concentrationBps: 0, daysSinceLastSettlement: 0 },
    redactedContext: "Synthetic fixture evidence only."
  });
  assert.equal(connectedAssessmentTypedData(unsigned).domain.chainId, 1952);
  assert.deepEqual(walletConnectedAssessmentTypedData(unsigned).types.EIP712Domain.map(({ name }) => name), ["name", "version", "chainId", "verifyingContract"]);
  const authorized = await buildConnectedAssessmentRequest({
    session,
    registrationTransactionHash: unsigned.registrationTransactionHash,
    funder: unsigned.funder,
    payerHistory: unsigned.payerHistory,
    redactedContext: unsigned.redactedContext,
    supplierAuthorization: await supplier.signTypedData(connectedAssessmentTypedData(unsigned))
  });
  assert.match(authorized.supplierAuthorization, /^0x[0-9a-f]{130}$/i);
  await assert.rejects(() => buildConnectedAssessmentRequest({
    session,
    registrationTransactionHash: unsigned.registrationTransactionHash,
    funder: funder.address,
    payerHistory: { ...unsigned.payerHistory, completedSettlements: 1 },
    redactedContext: unsigned.redactedContext
  }), /Unverified payer history is disabled/);
  await assert.rejects(() => buildConnectedAssessmentRequest({
    session,
    registrationTransactionHash: unsigned.registrationTransactionHash,
    funder: payer.address,
    payerHistory: unsigned.payerHistory,
    redactedContext: unsigned.redactedContext
  }), /Funder must be distinct/);
});
