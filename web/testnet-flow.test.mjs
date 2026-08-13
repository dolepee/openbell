import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  OPENBELL_TESTNET,
  approvalTypedData,
  addInvoiceSessionSignature,
  assertActionAgainstInvoice,
  assertWalletContext,
  buildConnectedAssessmentRequest,
  connectedAssessmentTypedData,
  invoiceTypedData,
  createInvoiceSession,
  rejectionTypedData,
  registrationActionFromSession,
  walletInvoiceTypedData,
  walletConnectedAssessmentTypedData,
  validateBrowserAction
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
