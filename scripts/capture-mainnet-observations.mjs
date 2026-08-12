import { readFile } from "node:fs/promises";
import { getterAbi, getterSpecs, verifyMainnetObservations, CONTRACT, DEPLOYMENT_TX, OFFICIAL_ENDPOINT_COMMITMENTS } from "./lib/mainnet-observation-verifier.mjs";
import { encodeFunctionData } from "viem";

const endpoints = [
  { provider: "official-xlayer", url: "https://rpc.xlayer.tech" },
  { provider: "official-okx", url: "https://xlayerrpc.okx.com" }
];

const transactionView = (value) => ({ hash: value.hash, from: value.from, to: value.to, nonce: value.nonce, value: value.value, input: value.input, blockNumber: value.blockNumber, blockHash: value.blockHash, transactionIndex: value.transactionIndex });
const receiptView = (value) => ({ transactionHash: value.transactionHash, contractAddress: value.contractAddress, from: value.from, to: value.to, status: value.status, blockNumber: value.blockNumber, blockHash: value.blockHash, transactionIndex: value.transactionIndex, gasUsed: value.gasUsed, effectiveGasPrice: value.effectiveGasPrice });
const blockView = (value) => ({ number: value.number, hash: value.hash, transactions: value.transactions });
const headView = (value) => ({ number: value.number, hash: value.hash });

const capture = async ({ provider, url }) => {
  let id = 0;
  const rpc = async (method, params = []) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    if (!response.ok) throw new Error(`${provider}:${method}:HTTP_${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${provider}:${method}:${body.error.message}`);
    return body.result;
  };
  const headBeforeNumber = await rpc("eth_blockNumber");
  const transaction = await rpc("eth_getTransactionByHash", [DEPLOYMENT_TX]);
  const receipt = await rpc("eth_getTransactionReceipt", [DEPLOYMENT_TX]);
  const deploymentBlock = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  const deploymentBlockByHash = await rpc("eth_getBlockByHash", [receipt.blockHash, false]);
  const runtimeCode = await rpc("eth_getCode", [CONTRACT, receipt.blockNumber]);
  const calls = {};
  for (const [name, outputs] of getterSpecs) {
    const abi = getterAbi(name, outputs);
    const data = encodeFunctionData({ abi, functionName: name });
    calls[name] = { data, result: await rpc("eth_call", [{ to: CONTRACT, data }, receipt.blockNumber]) };
  }
  const headAfterNumber = await rpc("eth_blockNumber");
  const [headBeforeBlock, headAfterBlock] = await Promise.all([
    rpc("eth_getBlockByNumber", [headBeforeNumber, false]), rpc("eth_getBlockByNumber", [headAfterNumber, false])
  ]);
  return {
    provider,
    endpointCommitment: OFFICIAL_ENDPOINT_COMMITMENTS[provider],
    chainId: await rpc("eth_chainId"),
    headBefore: { number: headBeforeNumber, block: headView(headBeforeBlock) },
    headAfter: { number: headAfterNumber, block: headView(headAfterBlock) },
    transaction: transactionView(transaction),
    receipt: receiptView(receipt),
    deploymentBlock: blockView(deploymentBlock),
    deploymentBlockByHash: blockView(deploymentBlockByHash),
    runtimeCode,
    calls
  };
};

const artifact = JSON.parse(await readFile(new URL("../out/OpenBellReceivables.sol/OpenBellReceivables.json", import.meta.url), "utf8"));
const observations = { schemaVersion: "openbell-xlayer-mainnet-observations-v1", providers: [] };
for (const endpoint of endpoints) observations.providers.push(await capture(endpoint));
verifyMainnetObservations({ observations, artifact });
process.stdout.write(`${JSON.stringify(observations, null, 2)}\n`);
