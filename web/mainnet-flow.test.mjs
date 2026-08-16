import assert from "node:assert/strict";
import test from "node:test";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { OPENBELL_MAINNET, buildUnsignedDealPackage } from "./deal-package.mjs";
import {
  OPENBELL_MAINNET_CONNECTED,
  addInvoiceSessionSignature,
  approvalTypedData,
  assertWalletContext,
  createInvoiceSession,
  invoiceTypedData,
  registrationActionFromSession,
  validateBrowserAction,
  walletInvoiceTypedData
} from "./testnet-flow.mjs";

const supplier = privateKeyToAccount(`0x${"51".repeat(32)}`);
const payer = privateKeyToAccount(`0x${"52".repeat(32)}`);
const funder = privateKeyToAccount(`0x${"53".repeat(32)}`);
const underwriter = privateKeyToAccount(`0x${"54".repeat(32)}`);

const preparedMainnetDeal = () => buildUnsignedDealPackage({
  supplier: supplier.address,
  payer: payer.address,
  faceValue: "100",
  requestedAdvance: "85",
  dueDate: "2026-08-31",
  nonce: "501",
  documentHash: `0x${"ab".repeat(32)}`,
  createdAtMs: Date.parse("2026-08-16T12:00:00.000Z"),
  target: OPENBELL_MAINNET
});

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
