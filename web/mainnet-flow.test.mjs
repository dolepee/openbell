import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, hashTypedData, keccak256, parseAbiParameters, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { OPENBELL_MAINNET, buildUnsignedDealPackage } from "./deal-package.mjs";
import { assertFundingCandidateAgainstInvoice, validateFundingCandidate } from "./funding-candidate.mjs";
import {
  OPENBELL_MAINNET_CONNECTED,
  addInvoiceSessionSignature,
  approvalTypedData,
  assertWalletContext,
  buildHumanEscalation,
  createInvoiceSession,
  finalizeHumanEscalation,
  humanEscalationTypedData,
  invoiceTypedData,
  rejectionTypedData,
  registrationActionFromSession,
  validateBrowserAction,
  walletInvoiceTypedData
} from "./testnet-flow.mjs";

const supplier = privateKeyToAccount(`0x${"51".repeat(32)}`);
const payer = privateKeyToAccount(`0x${"52".repeat(32)}`);
const funder = privateKeyToAccount(`0x${"53".repeat(32)}`);
const underwriter = privateKeyToAccount(`0x${"54".repeat(32)}`);

const preparedMainnetDeal = (requestedAdvance = "85") => buildUnsignedDealPackage({
  supplier: supplier.address,
  payer: payer.address,
  faceValue: "100",
  requestedAdvance,
  dueDate: "2026-08-31",
  nonce: "501",
  documentHash: `0x${"ab".repeat(32)}`,
  createdAtMs: Date.parse("2026-08-16T12:00:00.000Z"),
  target: OPENBELL_MAINNET
});

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
};
const artifactHashOf = (value) => keccak256(stringToHex(canonicalJson(value)));

const rejectedMainnetFixture = async (requestedAdvance = "85") => {
  const deal = await preparedMainnetDeal(requestedAdvance);
  const invoiceData = invoiceTypedData(deal.invoiceTerms, OPENBELL_MAINNET_CONNECTED);
  let session = await createInvoiceSession(deal);
  session = await addInvoiceSessionSignature(session, supplier.address, await supplier.signTypedData(invoiceData));
  session = await addInvoiceSessionSignature(session, payer.address, await payer.signTypedData(invoiceData));
  const modelDecision = {
    verdict: "REJECT",
    maximumAdvanceBps: 0,
    feeBps: 0,
    confidenceBps: 6500,
    reasons: ["DUAL_SIGNATURES_VERIFIED", "DOCUMENT_HASH_VERIFIED", "CLEAN_DUPLICATE_CHECK", "LIMITED_PAYER_HISTORY", "MODEL_UNCERTAINTY"],
    explanation: "The supplied registered mainnet evidence does not support approval."
  };
  const rawResponse = JSON.stringify({
    id: "mainnet-rejection-fixture",
    object: "chat.completion",
    model: "gpt-5.6-terra",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(modelDecision) } }]
  });
  const evidence = {
    provider: "bankr-chat-completions",
    providerResponseId: "mainnet-rejection-fixture",
    requestedModel: "gpt-5.6-terra",
    returnedModel: "gpt-5.6-terra",
    requestHash: `0x${"12".repeat(32)}`,
    responseHash: keccak256(stringToHex(rawResponse)),
    rawResponse,
    decision: modelDecision
  };
  const receiptCommitment = keccak256(encodeAbiParameters(
    parseAbiParameters("string provider, string providerResponseId, string requestedModel, string returnedModel, bytes32 requestHash, bytes32 responseHash"),
    [evidence.provider, evidence.providerResponseId, evidence.requestedModel, evidence.returnedModel, evidence.requestHash, evidence.responseHash]
  ));
  const modelId = `bankr:gpt-5.6-terra:receipt:${receiptCommitment}`;
  const modelHash = keccak256(encodeAbiParameters(
    parseAbiParameters("string modelId, string verdict, uint16 maximumAdvanceBps, uint16 feeBps, uint16 confidenceBps, string[] reasons, string explanation"),
    [modelId, modelDecision.verdict, modelDecision.maximumAdvanceBps, modelDecision.feeBps, modelDecision.confidenceBps, modelDecision.reasons, modelDecision.explanation]
  ));
  const riskReasonsHash = keccak256(encodeAbiParameters(
    parseAbiParameters("string[] reasons, string explanation"),
    [modelDecision.reasons, modelDecision.explanation]
  ));
  const riskTimestamp = Number(deal.invoiceTerms.issuedAt) + 120;
  const nonce = BigInt(evidence.requestHash).toString();
  const rejection = {
    invoiceId: deal.invoiceTerms.invoiceId,
    invoiceDigest: session.authorizedDigest,
    riskTimestamp: String(riskTimestamp),
    expiresAt: String(riskTimestamp + 1800),
    riskReasonsHash,
    modelHash,
    nonce
  };
  const decision = {
    verdict: "REJECT",
    invoiceId: rejection.invoiceId,
    invoiceDigest: rejection.invoiceDigest,
    riskTimestamp,
    expiresAt: riskTimestamp + 1800,
    riskReasonsHash,
    modelHash,
    reasons: modelDecision.reasons,
    explanation: modelDecision.explanation,
    modelId
  };
  const observation = {
    chainId: 196,
    receivables: OPENBELL_MAINNET_CONNECTED.receivables,
    settlementToken: OPENBELL_MAINNET_CONNECTED.settlementToken,
    blockNumber: "68000000",
    blockHash: `0x${"13".repeat(32)}`,
    blockTimestamp: riskTimestamp,
    registrationTransactionHash: `0x${"14".repeat(32)}`,
    status: "REGISTERED",
    invoiceId: deal.invoiceTerms.invoiceId,
    invoiceDigest: session.authorizedDigest,
    documentHash: deal.invoiceTerms.documentHash,
    supplier: supplier.address,
    payer: payer.address,
    faceValue: deal.invoiceTerms.faceValue,
    issuedAt: Number(deal.invoiceTerms.issuedAt),
    dueDate: Number(deal.invoiceTerms.dueDate),
    underwriter: underwriter.address,
    paused: false,
    decisionNonceUnused: true,
    documentHashRegistered: true,
    invoiceDigestRegistered: true
  };
  const core = {
    decision,
    modelEvidence: evidence,
    observation,
    signingRequest: {
      schemaVersion: "openbell-connected-decision-signing-v1",
      label: OPENBELL_MAINNET_CONNECTED.label,
      chainId: "196",
      underwriter: underwriter.address,
      authorizedDigest: hashTypedData(rejectionTypedData(rejection, OPENBELL_MAINNET_CONNECTED)),
      nonce
    }
  };
  return { assessment: { ...core, artifactHash: artifactHashOf(core) }, session };
};

const mainnetEnvelope = (kind, signer, authorizedDigest, payload) => ({
  schemaVersion: "openbell-mainnet-browser-action-v1",
  label: OPENBELL_MAINNET_CONNECTED.label,
  chainId: "196",
  kind,
  signer,
  authorizedDigest,
  payload
});

test("mainnet invoice handoff uses the verified chain-196 contract and numeric EIP-712 domain", async () => {
  const deal = await preparedMainnetDeal();
  let session = await createInvoiceSession(deal);
  assert.equal(session.schemaVersion, "openbell-mainnet-invoice-session-v1");
  assert.equal(session.label, OPENBELL_MAINNET_CONNECTED.label);
  const typedData = invoiceTypedData(deal.invoiceTerms, OPENBELL_MAINNET_CONNECTED);
  assert.equal(typedData.domain.chainId, 196);
  assert.equal(typedData.domain.verifyingContract, OPENBELL_MAINNET.verifyingContract);
  assert.equal(walletInvoiceTypedData(deal.invoiceTerms, OPENBELL_MAINNET_CONNECTED).domain.chainId, 196);
  session = await addInvoiceSessionSignature(session, supplier.address, await supplier.signTypedData(typedData));
  session = await addInvoiceSessionSignature(session, payer.address, await payer.signTypedData(typedData));
  const registration = await validateBrowserAction(await registrationActionFromSession(session));
  assert.equal(registration.chainId, 196);
  assert.equal(registration.to, OPENBELL_MAINNET.verifyingContract);
  assert.equal(registration.signer, supplier.address);
  assertWalletContext(registration, { account: supplier.address, chainId: 196 });
  assert.throws(() => assertWalletContext(registration, { account: supplier.address, chainId: 1952 }), /chain 196/);
});

test("mainnet funding reconstructs canonical USDG approval and preserves the 80 percent contract ceiling", async () => {
  const deal = await preparedMainnetDeal();
  const approval = {
    invoiceId: deal.invoiceTerms.invoiceId,
    invoiceDigest: `0x${"cc".repeat(32)}`,
    funder: funder.address,
    advanceAmount: deal.underwritingRequest.preAiUpperBound,
    repaymentAmount: "81600000",
    riskTimestamp: "1786900000",
    expiresAt: "1786901800",
    riskReasonsHash: `0x${"dd".repeat(32)}`,
    modelHash: `0x${"ee".repeat(32)}`,
    nonce: "502"
  };
  const typedData = approvalTypedData(approval, OPENBELL_MAINNET_CONNECTED);
  const action = await validateBrowserAction(mainnetEnvelope("APPROVE_FUNDING", funder.address, hashTypedData(typedData), {
    approval,
    underwriter: underwriter.address,
    underwriterSignature: await underwriter.signTypedData(typedData)
  }));
  assert.equal(action.to, OPENBELL_MAINNET.settlementToken);
  assert.equal(action.amount, 80_000_000n);
  assert.equal(action.value, 0n);
});

test("mainnet envelopes cannot invoke the testnet fixture faucet or drift to another deployment", async () => {
  await assert.rejects(validateBrowserAction(mainnetEnvelope("CLAIM_FIXTURE_TOKENS", funder.address, null, {})), /forbidden on mainnet/);
  await assert.rejects(validateBrowserAction({
    ...mainnetEnvelope("APPROVE_SETTLEMENT", payer.address, null, { invoiceId: `0x${"aa".repeat(32)}`, amount: "1" }),
    chainId: "1952"
  }), /wrong chain/);
  await assert.rejects(validateBrowserAction({
    ...mainnetEnvelope("APPROVE_SETTLEMENT", payer.address, null, { invoiceId: `0x${"aa".repeat(32)}`, amount: "1" }),
    label: "XLAYER TESTNET FIXTURE — NO REAL VALUE"
  }), /schema or deployment label/);
});

test("human escalation preserves a genuine rejection and enforces the tighter economic envelope", async () => {
  const { assessment, session } = await rejectedMainnetFixture();
  const escalation = await buildHumanEscalation({
    assessment,
    session,
    assessedRequestedAdvance: "85000000",
    funder: funder.address,
    advanceAmount: "25000000",
    riskTimestamp: "1786900000"
  });
  assert.equal(escalation.rejectedVerdict, "REJECT");
  assert.equal(escalation.rejectedArtifactHash, assessment.artifactHash);
  assert.equal(escalation.faceValue, "100000000");
  assert.equal(escalation.requestedAdvance, "85000000");
  assert.equal(escalation.approval.advanceAmount, "25000000");
  assert.equal(escalation.approval.repaymentAmount, "25250000");
  assert.equal(escalation.approval.modelHash, assessment.artifactHash);

  const signature = await underwriter.signTypedData(humanEscalationTypedData(escalation));
  const actions = await finalizeHumanEscalation(escalation, signature);
  assert.deepEqual(actions.map(({ kind }) => kind), ["APPROVE_FUNDING", "FUND_INVOICE", "APPROVE_SETTLEMENT", "SETTLE_INVOICE"]);
  assert.equal(actions[0].signer, funder.address);
  assert.equal(actions[2].signer, payer.address);
});

test("one-wallet funding candidate preserves the rejected artifact and exact two-action boundary", async () => {
  const { assessment, session } = await rejectedMainnetFixture();
  const escalation = await buildHumanEscalation({
    assessment,
    session,
    assessedRequestedAdvance: "85000000",
    funder: funder.address,
    advanceAmount: "25000000",
    riskTimestamp: "1786900000"
  });
  const actions = await finalizeHumanEscalation(escalation, await underwriter.signTypedData(humanEscalationTypedData(escalation)));
  const terms = session.dealPackage.invoiceTerms;
  const candidate = {
    schemaVersion: "openbell-mainnet-funding-candidate-v1",
    status: "OPEN",
    title: "One bounded supplier advance",
    summary: "Fund one dual-signed receivable after a preserved model rejection and a stricter disclosed human review.",
    invoice: {
      invoiceId: terms.invoiceId,
      documentHash: terms.documentHash,
      supplier: terms.supplier,
      payer: terms.payer,
      funder: funder.address,
      faceValue: terms.faceValue,
      requestedAdvance: "85000000",
      approvedAdvance: escalation.approval.advanceAmount,
      repaymentAmount: escalation.approval.repaymentAmount,
      dueDate: terms.dueDate
    },
    authority: {
      modelVerdict: "REJECT",
      policy: "HUMAN_REVIEW_AFTER_MODEL_REJECTION_V1",
      rejectedArtifactHash: assessment.artifactHash,
      expiresAt: escalation.approval.expiresAt
    },
    actions: actions.slice(0, 2)
  };
  const validated = await validateFundingCandidate(candidate, 1_786_900_100);
  assert.equal(validated.invoice.funder, funder.address);
  assert.equal(validated.invoice.approvedAdvance, 25_000_000n);
  assert.deepEqual([validated.approvalAction.kind, validated.fundingAction.kind], ["APPROVE_FUNDING", "FUND_INVOICE"]);
  const registeredRecord = {
    status: 1,
    supplier: validated.invoice.supplier,
    payer: validated.invoice.payer,
    funder: "0x0000000000000000000000000000000000000000",
    faceValue: validated.invoice.faceValue,
    advanceAmount: 0n,
    repaymentAmount: 0n,
    dueDate: validated.invoice.dueDate,
    documentHash: validated.invoice.documentHash,
    invoiceDigest: validated.fundingAction.invoiceDigest,
    decisionDigest: `0x${"00".repeat(32)}`
  };
  assert.equal(assertFundingCandidateAgainstInvoice(validated, registeredRecord), true);
  assert.throws(() => assertFundingCandidateAgainstInvoice(validated, { ...registeredRecord, faceValue: registeredRecord.faceValue + 1n }), /differs from/);

  await assert.rejects(validateFundingCandidate({ ...candidate, status: "CLOSED" }, 1_786_900_100), /No open/);
  await assert.rejects(validateFundingCandidate({ ...candidate, authority: { ...candidate.authority, expiresAt: "1786900000" } }, 1_786_900_100), /expired/);
  await assert.rejects(validateFundingCandidate({ ...candidate, invoice: { ...candidate.invoice, approvedAdvance: "25000001" } }, 1_786_900_100), /economics changed/);
  await assert.rejects(validateFundingCandidate({ ...candidate, authority: { ...candidate.authority, rejectedArtifactHash: `0x${"99".repeat(32)}` } }, 1_786_900_100), /no longer binds/);
  await assert.rejects(validateFundingCandidate({ ...candidate, actions: [...candidate.actions].reverse() }, 1_786_900_100), /order is invalid/);
});

test("human escalation rejects over-cap, altered economics, party collapse and invalid signatures", async () => {
  const { assessment, session } = await rejectedMainnetFixture();
  const escalationInput = { assessment, session, assessedRequestedAdvance: "85000000", funder: funder.address, advanceAmount: "25000000", riskTimestamp: "1786900000" };
  await assert.rejects(buildHumanEscalation({ ...escalationInput, advanceAmount: "25000001" }), /stricter human-review cap/);
  await assert.rejects(buildHumanEscalation({ ...escalationInput, funder: payer.address, advanceAmount: "1" }), /distinct/);
  const tamperedSession = structuredClone(session);
  tamperedSession.dealPackage.underwritingRequest.requestedAdvance = "100000000";
  await assert.rejects(buildHumanEscalation({ ...escalationInput, session: tamperedSession }), /does not match the committed assessment request/);
  const lowRequest = await rejectedMainnetFixture("10");
  await assert.rejects(buildHumanEscalation({ ...escalationInput, assessment: lowRequest.assessment, session: lowRequest.session, assessedRequestedAdvance: "10000000", advanceAmount: "25000000" }), /stricter human-review cap/);
  const escalation = await buildHumanEscalation(escalationInput);
  const changedRepayment = { ...escalation, approval: { ...escalation.approval, repaymentAmount: "25250001" } };
  assert.throws(() => humanEscalationTypedData(changedRepayment), /fixed policy fee/);
  const changedCommitment = { ...escalation, approval: { ...escalation.approval, modelHash: `0x${"99".repeat(32)}` } };
  assert.throws(() => humanEscalationTypedData(changedCommitment), /rejected assessment/);
  const changedAssessedRequest = { ...escalation, requestedAdvance: "100000000" };
  assert.throws(() => humanEscalationTypedData(changedAssessedRequest), /policy commitment changed/);
  const changedParty = { ...escalation, underwriter: payer.address };
  assert.throws(() => humanEscalationTypedData(changedParty), /parties must be distinct/);
  const wrongSignature = await payer.signTypedData(humanEscalationTypedData(escalation));
  await assert.rejects(finalizeHumanEscalation(escalation, wrongSignature), /wrong signer/);
});
