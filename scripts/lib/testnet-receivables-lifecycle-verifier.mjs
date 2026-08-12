import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  http,
  recoverAddress,
  recoverTypedDataAddress
} from "viem";

export const LIFECYCLE_EXECUTION_SCHEMA = "openbell-receivables-xlayer-testnet-lifecycle-execution-v1";
export const LIFECYCLE_VERIFICATION_SCHEMA = "openbell-receivables-xlayer-testnet-lifecycle-verified-v1";
export const XLAYER_TESTNET_CHAIN_ID = 1_952n;
export const MINIMUM_CONFIRMATIONS = 12n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EXPECTED_KINDS = [
  "PAYER_CLAIM",
  "FUNDER_CLAIM",
  "REGISTER_REJECTED",
  "ATTEST_REJECTION",
  "REGISTER_APPROVED",
  "FUNDER_APPROVE",
  "FUND_APPROVED",
  "PAYER_APPROVE",
  "SETTLE_APPROVED"
];

const tokenAbi = [
  { type: "function", name: "claimFixtureTokens", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "event", name: "Transfer", anonymous: false, inputs: [{ indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "value", type: "uint256" }] },
  { type: "event", name: "Approval", anonymous: false, inputs: [{ indexed: true, name: "owner", type: "address" }, { indexed: true, name: "spender", type: "address" }, { indexed: false, name: "value", type: "uint256" }] }
];

const invoiceTuple = {
  name: "terms",
  type: "tuple",
  components: [
    { name: "invoiceId", type: "bytes32" }, { name: "documentHash", type: "bytes32" },
    { name: "supplier", type: "address" }, { name: "payer", type: "address" },
    { name: "faceValue", type: "uint128" }, { name: "issuedAt", type: "uint64" },
    { name: "dueDate", type: "uint64" }, { name: "nonce", type: "uint256" }
  ]
};
const approvalTuple = {
  name: "approval",
  type: "tuple",
  components: [
    { name: "invoiceId", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" },
    { name: "funder", type: "address" }, { name: "advanceAmount", type: "uint128" },
    { name: "repaymentAmount", type: "uint128" }, { name: "riskTimestamp", type: "uint64" },
    { name: "expiresAt", type: "uint64" }, { name: "riskReasonsHash", type: "bytes32" },
    { name: "modelHash", type: "bytes32" }, { name: "nonce", type: "uint256" }
  ]
};
const rejectionTuple = {
  name: "rejection",
  type: "tuple",
  components: [
    { name: "invoiceId", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" },
    { name: "riskTimestamp", type: "uint64" }, { name: "expiresAt", type: "uint64" },
    { name: "riskReasonsHash", type: "bytes32" }, { name: "modelHash", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
};

const receivablesAbi = [
  { type: "function", name: "registerInvoice", stateMutability: "nonpayable", inputs: [invoiceTuple, { name: "supplierSignature", type: "bytes" }, { name: "payerSignature", type: "bytes" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "attestRejection", stateMutability: "nonpayable", inputs: [rejectionTuple, { name: "underwriterSignature", type: "bytes" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [approvalTuple, { name: "underwriterSignature", type: "bytes" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "invoiceId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "invoices", stateMutability: "view", inputs: [{ name: "invoiceId", type: "bytes32" }], outputs: [
    { name: "status", type: "uint8" }, { name: "supplier", type: "address" }, { name: "payer", type: "address" },
    { name: "funder", type: "address" }, { name: "faceValue", type: "uint128" }, { name: "advanceAmount", type: "uint128" },
    { name: "repaymentAmount", type: "uint128" }, { name: "dueDate", type: "uint64" }, { name: "documentHash", type: "bytes32" },
    { name: "invoiceDigest", type: "bytes32" }, { name: "decisionDigest", type: "bytes32" }
  ] },
  { type: "event", name: "InvoiceRegistered", anonymous: false, inputs: [
    { indexed: true, name: "invoiceId", type: "bytes32" }, { indexed: true, name: "invoiceDigest", type: "bytes32" },
    { indexed: true, name: "supplier", type: "address" }, { indexed: false, name: "payer", type: "address" },
    { indexed: false, name: "faceValue", type: "uint128" }, { indexed: false, name: "dueDate", type: "uint64" },
    { indexed: false, name: "documentHash", type: "bytes32" }
  ] },
  { type: "event", name: "InvoiceRejected", anonymous: false, inputs: [
    { indexed: true, name: "invoiceId", type: "bytes32" }, { indexed: true, name: "decisionDigest", type: "bytes32" },
    { indexed: false, name: "riskReasonsHash", type: "bytes32" }, { indexed: false, name: "modelHash", type: "bytes32" }
  ] },
  { type: "event", name: "InvoiceFunded", anonymous: false, inputs: [
    { indexed: true, name: "invoiceId", type: "bytes32" }, { indexed: true, name: "decisionDigest", type: "bytes32" },
    { indexed: true, name: "funder", type: "address" }, { indexed: false, name: "supplier", type: "address" },
    { indexed: false, name: "advanceAmount", type: "uint128" }, { indexed: false, name: "repaymentAmount", type: "uint128" },
    { indexed: false, name: "riskReasonsHash", type: "bytes32" }, { indexed: false, name: "modelHash", type: "bytes32" }
  ] },
  { type: "event", name: "InvoiceSettled", anonymous: false, inputs: [
    { indexed: true, name: "invoiceId", type: "bytes32" }, { indexed: true, name: "payer", type: "address" },
    { indexed: true, name: "funder", type: "address" }, { indexed: false, name: "repaymentAmount", type: "uint128" }
  ] }
];

const fail = (message) => { throw new Error(`LIFECYCLE_VERIFICATION:${message}`); };
const requireTrue = (condition, message) => { if (!condition) fail(message); };
const lower = (value) => String(value).toLowerCase();
const quantity = (value) => BigInt(value);
const canonicalAddress = (value, label) => {
  try { return getAddress(value); } catch { fail(`INVALID_${label.toUpperCase()}_ADDRESS`); }
};
const sameAddress = (left, right) => lower(left) === lower(right);
const plain = (value) => typeof value === "bigint" ? value.toString() : Array.isArray(value) ? value.map(plain) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)])) : value;

const validatePacket = async (packet) => {
  requireTrue(packet?.schemaVersion === LIFECYCLE_EXECUTION_SCHEMA, "WRONG_PACKET_SCHEMA");
  requireTrue(packet.label === "XLAYER TESTNET FIXTURE — NO REAL VALUE", "WRONG_FIXTURE_LABEL");
  requireTrue(quantity(packet.chainId) === XLAYER_TESTNET_CHAIN_ID, "WRONG_CHAIN");
  requireTrue(packet.actions?.length === EXPECTED_KINDS.length, "WRONG_ACTION_COUNT");
  requireTrue(packet.actions.every((action, index) => action.kind === EXPECTED_KINDS[index]), "WRONG_ACTION_ORDER");
  requireTrue(packet.economics.faceValue === "100000000", "WRONG_FACE_VALUE");
  requireTrue(packet.economics.requestedAdvance === "75000000", "WRONG_REQUEST");
  requireTrue(packet.economics.modelMaximumAdvanceBps === "8500", "WRONG_MODEL_CAP");
  requireTrue(packet.economics.contractMaximumAdvanceBps === "8000", "WRONG_CONTRACT_CAP");
  requireTrue(packet.economics.effectiveAdvance === "75000000", "WRONG_EFFECTIVE_ADVANCE");
  requireTrue(packet.economics.modelFeeBps === "100", "WRONG_MODEL_FEE");
  requireTrue(packet.economics.repayment === "75750000", "WRONG_REPAYMENT");

  const token = canonicalAddress(packet.deployment.fixtureToken, "token");
  const receivables = canonicalAddress(packet.deployment.receivables, "receivables");
  const supplier = canonicalAddress(packet.roles.supplier, "supplier");
  const payer = canonicalAddress(packet.roles.payer, "payer");
  const funder = canonicalAddress(packet.roles.funder, "funder");
  const underwriter = canonicalAddress(packet.deployment.underwriter, "underwriter");
  requireTrue(new Set([supplier, payer, funder].map(lower)).size === 3, "COLLAPSED_LIFECYCLE_ROLES");

  const domain = packet.eip712.domain;
  requireTrue(typeof domain.chainId === "number" && Number.isSafeInteger(domain.chainId), "EIP712_CHAIN_ID_MUST_BE_NUMERIC");
  requireTrue(BigInt(domain.chainId) === XLAYER_TESTNET_CHAIN_ID && sameAddress(domain.verifyingContract, receivables), "WRONG_EIP712_DOMAIN");
  const recoverDeclaredDigest = async (digest, signature, signer, label) => {
    requireTrue(sameAddress(await recoverAddress({ hash: digest, signature }), signer), label);
  };
  const rejected = packet.eip712.invoices.rejected;
  const approved = packet.eip712.invoices.approved;
  for (const invoice of [rejected, approved]) {
    const digest = hashTypedData({ domain, types: packet.eip712.invoiceTypes, primaryType: "InvoiceTerms", message: invoice.terms });
    requireTrue(lower(digest) === lower(invoice.invoiceDigest), "INVOICE_DIGEST_MISMATCH");
    requireTrue(sameAddress(await recoverTypedDataAddress({ domain, types: packet.eip712.invoiceTypes, primaryType: "InvoiceTerms", message: invoice.terms, signature: invoice.supplierSignature }), supplier), "WRONG_SUPPLIER_SIGNATURE");
    requireTrue(sameAddress(await recoverTypedDataAddress({ domain, types: packet.eip712.invoiceTypes, primaryType: "InvoiceTerms", message: invoice.terms, signature: invoice.payerSignature }), payer), "WRONG_PAYER_SIGNATURE");
    await recoverDeclaredDigest(invoice.invoiceDigest, invoice.supplierSignature, supplier, "WRONG_SUPPLIER_DECLARED_DIGEST_SIGNATURE");
    await recoverDeclaredDigest(invoice.invoiceDigest, invoice.payerSignature, payer, "WRONG_PAYER_DECLARED_DIGEST_SIGNATURE");
  }
  const rejectionDigest = hashTypedData({ domain, types: packet.eip712.rejectionTypes, primaryType: "RiskRejection", message: packet.eip712.rejection });
  const approvalDigest = hashTypedData({ domain, types: packet.eip712.approvalTypes, primaryType: "RiskApproval", message: packet.eip712.approval });
  requireTrue(lower(rejectionDigest) === lower(packet.eip712.rejectionDigest), "REJECTION_DIGEST_MISMATCH");
  requireTrue(lower(approvalDigest) === lower(packet.eip712.approvalDigest), "APPROVAL_DIGEST_MISMATCH");
  requireTrue(sameAddress(await recoverTypedDataAddress({ domain, types: packet.eip712.rejectionTypes, primaryType: "RiskRejection", message: packet.eip712.rejection, signature: packet.eip712.rejectionSignature }), underwriter), "WRONG_REJECTION_SIGNER");
  requireTrue(sameAddress(await recoverTypedDataAddress({ domain, types: packet.eip712.approvalTypes, primaryType: "RiskApproval", message: packet.eip712.approval, signature: packet.eip712.approvalSignature }), underwriter), "WRONG_APPROVAL_SIGNER");
  await recoverDeclaredDigest(packet.eip712.rejectionDigest, packet.eip712.rejectionSignature, underwriter, "WRONG_REJECTION_DECLARED_DIGEST_SIGNATURE");
  await recoverDeclaredDigest(packet.eip712.approvalDigest, packet.eip712.approvalSignature, underwriter, "WRONG_APPROVAL_DECLARED_DIGEST_SIGNATURE");

  const calls = [
    encodeFunctionData({ abi: tokenAbi, functionName: "claimFixtureTokens" }),
    encodeFunctionData({ abi: tokenAbi, functionName: "claimFixtureTokens" }),
    encodeFunctionData({ abi: receivablesAbi, functionName: "registerInvoice", args: [rejected.terms, rejected.supplierSignature, rejected.payerSignature] }),
    encodeFunctionData({ abi: receivablesAbi, functionName: "attestRejection", args: [packet.eip712.rejection, packet.eip712.rejectionSignature] }),
    encodeFunctionData({ abi: receivablesAbi, functionName: "registerInvoice", args: [approved.terms, approved.supplierSignature, approved.payerSignature] }),
    encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [receivables, 75_000_000n] }),
    encodeFunctionData({ abi: receivablesAbi, functionName: "fund", args: [packet.eip712.approval, packet.eip712.approvalSignature] }),
    encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [receivables, 75_750_000n] }),
    encodeFunctionData({ abi: receivablesAbi, functionName: "settle", args: [approved.terms.invoiceId] })
  ];
  const senders = [payer, funder, supplier, supplier, supplier, funder, funder, payer, payer];
  const targets = [token, token, receivables, receivables, receivables, token, receivables, token, receivables];
  packet.actions.forEach((action, index) => {
    requireTrue(sameAddress(action.from, senders[index]) && sameAddress(action.to, targets[index]), `ACTION_${index}_ENVELOPE`);
    requireTrue(quantity(action.value) === 0n, `ACTION_${index}_NONZERO_VALUE`);
    requireTrue(lower(action.calldata) === lower(calls[index]), `ACTION_${index}_CALLDATA`);
  });
  return { token, receivables, supplier, payer, funder, rejected, approved, rejectionDigest, approvalDigest };
};

const call = async (provider, to, abi, functionName, args, blockNumber) => {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await provider.call({ to, data, blockNumber });
  return decodeFunctionResult({ abi, functionName, data: result });
};

const balances = async (provider, ctx, blockNumber) => Object.fromEntries(await Promise.all(
  Object.entries({ supplier: ctx.supplier, payer: ctx.payer, funder: ctx.funder, receivables: ctx.receivables }).map(async ([name, address]) => [name, quantity(await call(provider, ctx.token, tokenAbi, "balanceOf", [address], blockNumber))])
));

const relevantLogs = (receipt, ctx) => receipt.logs.filter((log) => sameAddress(log.address, ctx.token) || sameAddress(log.address, ctx.receivables)).map((log) => {
  const abi = sameAddress(log.address, ctx.token) ? tokenAbi : receivablesAbi;
  const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: true });
  return { address: getAddress(log.address), name: decoded.eventName, args: plain(decoded.args) };
});

const expectedLogNames = [
  ["Transfer"], ["Transfer"], ["InvoiceRegistered"], ["InvoiceRejected"], ["InvoiceRegistered"],
  ["Approval"], ["Transfer", "InvoiceFunded"], ["Approval"], ["Transfer", "InvoiceSettled"]
];

const inspectProvider = async (provider, packet, hashes, ctx) => {
  requireTrue(quantity(await provider.chainId()) === XLAYER_TESTNET_CHAIN_ID, `${provider.name}:WRONG_CHAIN`);
  const head = quantity(await provider.blockNumber());
  const observations = [];
  for (let index = 0; index < hashes.length; index += 1) {
    const [tx, receipt] = await Promise.all([provider.transaction(hashes[index]), provider.receipt(hashes[index])]);
    requireTrue(tx && receipt && lower(tx.hash) === lower(hashes[index]) && lower(receipt.transactionHash) === lower(hashes[index]), `${provider.name}:ACTION_${index}_MISSING`);
    const action = packet.actions[index];
    requireTrue(sameAddress(tx.from, action.from) && sameAddress(tx.to, action.to), `${provider.name}:ACTION_${index}_ENVELOPE`);
    requireTrue(quantity(tx.nonce) === quantity(action.nonce) && quantity(tx.value) === 0n && lower(tx.input) === lower(action.calldata), `${provider.name}:ACTION_${index}_TRANSACTION`);
    requireTrue(receipt.status === "success" || quantity(receipt.status) === 1n, `${provider.name}:ACTION_${index}_FAILED`);
    requireTrue(lower(receipt.blockHash) === lower(tx.blockHash) && quantity(receipt.blockNumber) === quantity(tx.blockNumber), `${provider.name}:ACTION_${index}_BLOCK`);
    const block = await provider.blockByNumber(quantity(receipt.blockNumber));
    const byHash = await provider.blockByHash(receipt.blockHash);
    requireTrue(quantity(block.number) === quantity(receipt.blockNumber) && lower(block.hash) === lower(receipt.blockHash), `${provider.name}:ACTION_${index}_CANONICAL_BLOCK`);
    requireTrue(quantity(byHash.number) === quantity(receipt.blockNumber) && lower(byHash.hash) === lower(receipt.blockHash), `${provider.name}:ACTION_${index}_BLOCK_HASH_LOOKUP`);
    requireTrue(lower(block.transactions[Number(quantity(receipt.transactionIndex))]) === lower(hashes[index]), `${provider.name}:ACTION_${index}_INDEX`);
    requireTrue(head - quantity(receipt.blockNumber) + 1n >= MINIMUM_CONFIRMATIONS, `${provider.name}:ACTION_${index}_CONFIRMATIONS`);
    const logs = relevantLogs(receipt, ctx);
    requireTrue(JSON.stringify(logs.map((log) => log.name)) === JSON.stringify(expectedLogNames[index]), `${provider.name}:ACTION_${index}_LOGS`);
    observations.push({ transactionHash: hashes[index], blockNumber: quantity(receipt.blockNumber), blockHash: receipt.blockHash, logs });
  }
  for (let index = 1; index < observations.length; index += 1) requireTrue(observations[index].blockNumber >= observations[index - 1].blockNumber, `${provider.name}:ACTION_ORDER`);

  const beforeRejected = observations[2].blockNumber - 1n;
  const afterRejected = observations[3].blockNumber;
  const beforeFund = observations[6].blockNumber - 1n;
  const afterFund = observations[6].blockNumber;
  const beforeSettle = observations[8].blockNumber - 1n;
  const afterSettle = observations[8].blockNumber;
  const [rejectedBefore, rejectedAfter, fundBefore, fundAfter, settleBefore, settleAfter] = await Promise.all([
    balances(provider, ctx, beforeRejected), balances(provider, ctx, afterRejected), balances(provider, ctx, beforeFund),
    balances(provider, ctx, afterFund), balances(provider, ctx, beforeSettle), balances(provider, ctx, afterSettle)
  ]);
  for (const role of Object.keys(rejectedBefore)) requireTrue(rejectedBefore[role] === rejectedAfter[role], `${provider.name}:REJECTION_MOVED_${role.toUpperCase()}`);
  requireTrue(fundAfter.supplier - fundBefore.supplier === 75_000_000n && fundBefore.funder - fundAfter.funder === 75_000_000n, `${provider.name}:WRONG_FUND_DELTAS`);
  requireTrue(fundAfter.payer === fundBefore.payer && fundAfter.receivables === fundBefore.receivables, `${provider.name}:OTHER_FUND_BALANCE_MOVED`);
  requireTrue(settleBefore.payer - settleAfter.payer === 75_750_000n && settleAfter.funder - settleBefore.funder === 75_750_000n, `${provider.name}:WRONG_SETTLEMENT_DELTAS`);
  requireTrue(settleAfter.supplier === settleBefore.supplier && settleAfter.receivables === settleBefore.receivables, `${provider.name}:OTHER_SETTLEMENT_BALANCE_MOVED`);

  const [rejectedRecord, approvedRecord] = await Promise.all([
    call(provider, ctx.receivables, receivablesAbi, "invoices", [ctx.rejected.terms.invoiceId], afterSettle),
    call(provider, ctx.receivables, receivablesAbi, "invoices", [ctx.approved.terms.invoiceId], afterSettle)
  ]);
  requireTrue(quantity(rejectedRecord[0]) === 5n && quantity(rejectedRecord[5]) === 0n && quantity(rejectedRecord[6]) === 0n, `${provider.name}:REJECTED_RECORD`);
  requireTrue(quantity(approvedRecord[0]) === 3n && quantity(approvedRecord[4]) === 100_000_000n && quantity(approvedRecord[5]) === 75_000_000n && quantity(approvedRecord[6]) === 75_750_000n, `${provider.name}:APPROVED_RECORD`);

  const headAfter = quantity(await provider.blockNumber());
  requireTrue(headAfter >= head, `${provider.name}:TIP_REGRESSION`);
  for (const observation of observations) {
    const block = await provider.blockByNumber(observation.blockNumber);
    requireTrue(lower(block.hash) === lower(observation.blockHash), `${provider.name}:FINAL_REORG_CHECK`);
  }
  return plain({ provider: provider.name, head: headAfter, observations, rejectedBefore, rejectedAfter, fundBefore, fundAfter, settleBefore, settleAfter, rejectedRecord, approvedRecord });
};

export const verifyXLayerTestnetReceivablesLifecycle = async ({ packet, transactionHashes, providers }) => {
  requireTrue(Array.isArray(transactionHashes) && transactionHashes.length === EXPECTED_KINDS.length, "WRONG_TRANSACTION_HASH_COUNT");
  requireTrue(new Set(transactionHashes.map(lower)).size === transactionHashes.length, "DUPLICATE_TRANSACTION_HASH");
  requireTrue(Array.isArray(providers) && providers.length === 2 && providers[0].name !== providers[1].name, "TWO_DISTINCT_PROVIDERS_REQUIRED");
  const ctx = await validatePacket(packet);
  const results = [];
  for (const provider of providers) results.push(await inspectProvider(provider, packet, transactionHashes, ctx));
  requireTrue(JSON.stringify(results[0].observations) === JSON.stringify(results[1].observations), "PROVIDER_RECEIPT_DISAGREEMENT");
  requireTrue(JSON.stringify(results[0].rejectedRecord) === JSON.stringify(results[1].rejectedRecord), "PROVIDER_REJECTION_STATE_DISAGREEMENT");
  requireTrue(JSON.stringify(results[0].approvedRecord) === JSON.stringify(results[1].approvedRecord), "PROVIDER_APPROVAL_STATE_DISAGREEMENT");
  return {
    schemaVersion: LIFECYCLE_VERIFICATION_SCHEMA,
    label: "XLAYER TESTNET FIXTURE — NO REAL VALUE",
    chainId: String(XLAYER_TESTNET_CHAIN_ID),
    transactionCount: "9",
    minimumConfirmations: String(MINIMUM_CONFIRMATIONS),
    economics: packet.economics,
    rejection: { status: "REJECTED", zeroTokenMovementVerified: true, decisionDigest: ctx.rejectionDigest },
    approval: { status: "SETTLED", effectiveAdvance: "75000000", repayment: "75750000", decisionDigest: ctx.approvalDigest },
    providers: results,
    disclosures: { fixtureNoValue: true, canonicalUsdG: false, realValue: false, liveLifecycleVerified: true, explorerSourceVerified: false, submissionReady: false }
  };
};

export const createReadOnlyLifecycleProvider = (name, rpcUrl) => {
  requireTrue(typeof name === "string" && name.length > 0, "PROVIDER_NAME_REQUIRED");
  requireTrue(typeof rpcUrl === "string" && rpcUrl.startsWith("https://") && !/@/.test(rpcUrl), "OFFICIAL_HTTPS_RPC_REQUIRED");
  const chain = defineChain({
    id: Number(XLAYER_TESTNET_CHAIN_ID),
    name: "X Layer Testnet",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } }
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 0, timeout: 20_000 }) });
  return Object.freeze({
    name,
    chainId: async () => BigInt(await client.getChainId()),
    blockNumber: async () => await client.getBlockNumber(),
    transaction: async (hash) => await client.getTransaction({ hash }),
    receipt: async (hash) => await client.getTransactionReceipt({ hash }),
    blockByNumber: async (blockNumber) => await client.getBlock({ blockNumber }),
    blockByHash: async (blockHash) => await client.getBlock({ blockHash }),
    call: async ({ to, data, blockNumber }) => {
      const result = await client.call({ to, data, blockNumber });
      requireTrue(typeof result.data === "string", "RPC_CALL_RETURNED_NO_DATA");
      return result.data;
    }
  });
};

export const lifecycleVerifierAbis = { tokenAbi, receivablesAbi };
