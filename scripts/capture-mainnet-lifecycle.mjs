import { OFFICIAL_ENDPOINT_COMMITMENTS, TRANSACTIONS, lifecycleCalls, verifyMainnetLifecycleObservations } from "./lib/mainnet-lifecycle-verifier.mjs";

const endpoints = [
  { provider: "official-xlayer", url: "https://rpc.xlayer.tech" },
  { provider: "official-okx", url: "https://xlayerrpc.okx.com" }
];

const transactionView = (value) => ({ hash: value.hash, from: value.from, to: value.to, nonce: value.nonce, value: value.value, input: value.input, blockNumber: value.blockNumber, blockHash: value.blockHash, transactionIndex: value.transactionIndex });
const receiptView = (value) => ({ transactionHash: value.transactionHash, status: value.status, blockNumber: value.blockNumber, blockHash: value.blockHash, transactionIndex: value.transactionIndex, gasUsed: value.gasUsed, effectiveGasPrice: value.effectiveGasPrice, logs: value.logs.map(({ address, topics, data, logIndex }) => ({ address, topics, data, logIndex })) });

const capture = async ({ provider, url }) => {
  let id = 0;
  const rpc = async (method, params = []) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    if (!response.ok) throw new Error(`${provider}:${method}:HTTP_${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${provider}:${method}:${body.error.message}`);
    return body.result;
  };
  const transactions = [];
  for (const expected of TRANSACTIONS) {
    const [transaction, receipt] = await Promise.all([rpc("eth_getTransactionByHash", [expected.hash]), rpc("eth_getTransactionReceipt", [expected.hash])]);
    const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
    transactions.push({ action: expected.action, transaction: transactionView(transaction), receipt: receiptView(receipt), block: { number: block.number, hash: block.hash, transactions: block.transactions } });
  }
  const calls = {};
  for (const [name, spec] of Object.entries(lifecycleCalls)) {
    const block = `0x${spec.block.toString(16)}`;
    calls[name] = { to: spec.to, block, data: spec.data, result: await rpc("eth_call", [{ to: spec.to, data: spec.data }, block]) };
  }
  const headNumber = await rpc("eth_blockNumber");
  const head = await rpc("eth_getBlockByNumber", [headNumber, false]);
  return { provider, endpointCommitment: OFFICIAL_ENDPOINT_COMMITMENTS[provider], chainId: await rpc("eth_chainId"), head: { number: head.number, hash: head.hash }, transactions, calls };
};

const observations = { schemaVersion: "openbell-xlayer-mainnet-lifecycle-observations-v1", providers: [] };
for (const endpoint of endpoints) observations.providers.push(await capture(endpoint));
verifyMainnetLifecycleObservations(observations);
process.stdout.write(`${JSON.stringify(observations, null, 2)}\n`);
