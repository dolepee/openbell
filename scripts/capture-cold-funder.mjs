import { OFFICIAL_ENDPOINT_COMMITMENTS } from "./lib/mainnet-lifecycle-verifier.mjs";
import { FUNDING, calls, verifyColdFunderObservations } from "./lib/cold-funder-verifier.mjs";

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
  const [transaction, receipt] = await Promise.all([rpc("eth_getTransactionByHash", [FUNDING.hash]), rpc("eth_getTransactionReceipt", [FUNDING.hash])]);
  const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  const observedCalls = {};
  for (const [name, spec] of Object.entries(calls)) {
    const blockTag = `0x${spec.block.toString(16)}`;
    observedCalls[name] = { to: spec.to, block: blockTag, data: spec.data, result: await rpc("eth_call", [{ to: spec.to, data: spec.data }, blockTag]) };
  }
  const headNumber = await rpc("eth_blockNumber");
  const head = await rpc("eth_getBlockByNumber", [headNumber, false]);
  return {
    provider, endpointCommitment: OFFICIAL_ENDPOINT_COMMITMENTS[provider], chainId: await rpc("eth_chainId"),
    head: { number: head.number, hash: head.hash },
    funding: { transaction: transactionView(transaction), receipt: receiptView(receipt), block: { number: block.number, hash: block.hash, transactions: block.transactions } },
    calls: observedCalls
  };
};

const observations = { schemaVersion: "openbell-independent-cold-funder-observations-v1", providers: [] };
for (const endpoint of endpoints) observations.providers.push(await capture(endpoint));
verifyColdFunderObservations(observations);
process.stdout.write(`${JSON.stringify(observations, null, 2)}\n`);
