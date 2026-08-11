import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { encodeFunctionData, encodeFunctionResult, getAddress } from "viem";

import {
  buildFixtureDeploymentCandidate,
  FIXTURE_DEPLOYMENT_SCHEMA,
  FIXTURE_VERIFICATION_SCHEMA,
  verifyFixtureDeployment
} from "./lib/testnet-fixture-deployment-verifier.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const DEPLOYER = getAddress("0x00000000000000000000000000000000000D3F10");
const OWNER = getAddress("0x00000000000000000000000000000000000A11CE");
const UNDERWRITER = getAddress("0x0000000000000000000000000000000000000B0B");
const TOKEN_TX = `0x${"11".repeat(32)}`;
const RECEIVABLES_TX = `0x${"22".repeat(32)}`;
const TOKEN_BLOCK_HASH = `0x${"aa".repeat(32)}`;
const RECEIVABLES_BLOCK_HASH = `0x${"bb".repeat(32)}`;
const TIP_BLOCK_HASH = `0x${"cc".repeat(32)}`;

const artifactPaths = {
  "out/OpenBellTestUSDG.sol/OpenBellTestUSDG.json": resolve(
    repositoryRoot,
    "out/OpenBellTestUSDG.sol/OpenBellTestUSDG.json"
  ),
  "out/OpenBellReceivables.sol/OpenBellReceivables.json": resolve(
    repositoryRoot,
    "out/OpenBellReceivables.sol/OpenBellReceivables.json"
  )
};

const tokenArtifactText = await readFile(artifactPaths["out/OpenBellTestUSDG.sol/OpenBellTestUSDG.json"], "utf8");
const receivablesArtifactText = await readFile(
  artifactPaths["out/OpenBellReceivables.sol/OpenBellReceivables.json"],
  "utf8"
);
const tokenArtifact = JSON.parse(tokenArtifactText);
const receivablesArtifact = JSON.parse(receivablesArtifactText);

const makeRepository = (overrides = {}) => {
  const calls = { rebuild: 0 };
  return {
    calls,
    async head() {
      return overrides.head ?? HEAD;
    },
    async status() {
      return overrides.status ?? "";
    },
    async submodules() {
      return overrides.submodules ?? " 1111111111111111111111111111111111111111 lib/openzeppelin-contracts\n";
    },
    async rebuildOffline() {
      calls.rebuild += 1;
      if (overrides.rebuildOffline) await overrides.rebuildOffline();
    },
    async artifact(path) {
      if (overrides.artifact) return await overrides.artifact(path);
      return await readFile(artifactPaths[path], "utf8");
    },
    async source(path) {
      if (overrides.source) return await overrides.source(path);
      return await readFile(resolve(repositoryRoot, path));
    }
  };
};

const candidate = await buildFixtureDeploymentCandidate({
  repository: makeRepository(),
  deployer: DEPLOYER,
  owner: OWNER,
  underwriter: UNDERWRITER,
  startingNonce: 7n
});

const functionResult = (artifact, functionName, result) => ({
  data: encodeFunctionData({ abi: artifact.abi, functionName }),
  result: encodeFunctionResult({ abi: artifact.abi, functionName, result })
});

const callResults = new Map(
  [
    [tokenArtifact, "name", "OpenBell Test USDG (Fixture)"],
    [tokenArtifact, "symbol", "tUSDG"],
    [tokenArtifact, "decimals", 6],
    [tokenArtifact, "FAUCET_AMOUNT", 1_000_000_000n],
    [tokenArtifact, "totalSupply", 0n],
    [receivablesArtifact, "settlementToken", candidate.deployments.fixtureToken.address],
    [receivablesArtifact, "owner", OWNER],
    [receivablesArtifact, "pendingOwner", "0x0000000000000000000000000000000000000000"],
    [receivablesArtifact, "underwriter", UNDERWRITER],
    [receivablesArtifact, "paused", false],
    [receivablesArtifact, "BPS", 10_000],
    [receivablesArtifact, "maxAdvanceBps", 8_000],
    [receivablesArtifact, "maxFeeBps", 2_000],
    [receivablesArtifact, "maxRiskAge", 3_600n],
    [receivablesArtifact, "maxInvoiceAge", 604_800n],
    [receivablesArtifact, "maxInvoiceTenor", 7_776_000n],
    [receivablesArtifact, "INVOICE_TYPEHASH", "0x3fa7362141ca2043801d61b9efee211fcbc943d3c40221f3ef30e1c50e933686"],
    [receivablesArtifact, "APPROVAL_TYPEHASH", "0x0237a21cd055f0c6cd3ddb0b019ef5b9df26dcd8f5ddeaa837de0477b1d7be2f"],
    [receivablesArtifact, "REJECTION_TYPEHASH", "0xc37ca47ab045a2d5cbd3c6754a2261ef43266e00880b7d707bc3daef81dd9a65"],
    [
      receivablesArtifact,
      "eip712Domain",
      [
        "0x0f",
        "OpenBell Receivables",
        "1",
        1_952n,
        candidate.deployments.receivables.address,
        `0x${"00".repeat(32)}`,
        []
      ]
    ]
  ].map(([artifact, functionName, result]) => {
    const encoded = functionResult(artifact, functionName, result);
    return [encoded.data, encoded.result];
  })
);

const clone = (value) => structuredClone(value);

const mutateRuntimeByte = (runtime, byteOffset, replacement = "01") => {
  const characterOffset = 2 + byteOffset * 2;
  const current = runtime.slice(characterOffset, characterOffset + 2);
  const next = current === replacement ? "02" : replacement;
  return `${runtime.slice(0, characterOffset)}${next}${runtime.slice(characterOffset + 2)}`;
};

const numericLeafPaths = (value, path = "$", output = []) => {
  if (typeof value === "number" || typeof value === "bigint") output.push(path);
  else if (Array.isArray(value)) value.forEach((entry, index) => numericLeafPaths(entry, `${path}[${index}]`, output));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => numericLeafPaths(entry, `${path}.${key}`, output));
  }
  return output;
};

const makeRpc = (mutate = () => {}) => {
  const state = {
    chainId: 1_952n,
    tip: 112n,
    tokenCode: tokenArtifact.deployedBytecode.object,
    receivablesCode: receivablesArtifact.deployedBytecode.object,
    calls: new Map(callResults),
    transactions: {
      [TOKEN_TX]: {
        hash: TOKEN_TX,
        from: DEPLOYER,
        to: null,
        input: candidate.deployments.fixtureToken.creationInput,
        value: 0n,
        nonce: 7n,
        chainId: 1_952n,
        blockNumber: 100n,
        blockHash: TOKEN_BLOCK_HASH,
        transactionIndex: 0n
      },
      [RECEIVABLES_TX]: {
        hash: RECEIVABLES_TX,
        from: DEPLOYER,
        to: null,
        input: candidate.deployments.receivables.creationInput,
        value: 0n,
        nonce: 8n,
        chainId: 1_952n,
        blockNumber: 101n,
        blockHash: RECEIVABLES_BLOCK_HASH,
        transactionIndex: 0n
      }
    },
    receipts: {
      [TOKEN_TX]: {
        transactionHash: TOKEN_TX,
        status: "success",
        from: DEPLOYER,
        to: null,
        contractAddress: candidate.deployments.fixtureToken.address,
        blockNumber: 100n,
        blockHash: TOKEN_BLOCK_HASH,
        transactionIndex: 0n,
        gasUsed: 650_000n
      },
      [RECEIVABLES_TX]: {
        transactionHash: RECEIVABLES_TX,
        status: "success",
        from: DEPLOYER,
        to: null,
        contractAddress: candidate.deployments.receivables.address,
        blockNumber: 101n,
        blockHash: RECEIVABLES_BLOCK_HASH,
        transactionIndex: 0n,
        gasUsed: 2_700_000n
      }
    },
    blocks: {
      "100": { number: 100n, hash: TOKEN_BLOCK_HASH, timestamp: 2_000_000_000n, transactions: [TOKEN_TX] },
      "101": {
        number: 101n,
        hash: RECEIVABLES_BLOCK_HASH,
        timestamp: 2_000_000_001n,
        transactions: [RECEIVABLES_TX]
      },
      "112": { number: 112n, hash: TIP_BLOCK_HASH, timestamp: 2_000_000_012n, transactions: [] }
    }
  };
  mutate(state);
  const blockReads = new Map();
  return {
    state,
    async chainId() {
      return state.chainId;
    },
    async blockNumber() {
      return state.tip;
    },
    async transaction(hash) {
      return clone(state.transactions[hash]);
    },
    async receipt(hash) {
      return clone(state.receipts[hash]);
    },
    async block(number) {
      const key = String(number);
      const count = (blockReads.get(key) ?? 0) + 1;
      blockReads.set(key, count);
      if (state.blockMutation && count > 1) return clone(state.blockMutation(key, state.blocks[key]));
      return clone(state.blocks[key]);
    },
    async blockByHash(hash) {
      return clone(Object.values(state.blocks).find((block) => block.hash === hash));
    },
    async code(address, blockNumber) {
      assert.equal(blockNumber, 112n);
      if (getAddress(address) === getAddress(candidate.deployments.fixtureToken.address)) return state.tokenCode;
      if (getAddress(address) === getAddress(candidate.deployments.receivables.address)) return state.receivablesCode;
      return "0x";
    },
    async call({ to, data, blockNumber }) {
      assert.equal(blockNumber, 112n);
      assert.ok(
        getAddress(to) === getAddress(candidate.deployments.fixtureToken.address) ||
          getAddress(to) === getAddress(candidate.deployments.receivables.address)
      );
      const result = state.calls.get(data);
      if (!result) throw new Error(`unexpected call ${data}`);
      return result;
    }
  };
};

const verify = async (rpc, candidateInput = candidate, repository = makeRepository()) =>
  await verifyFixtureDeployment({
    candidate: candidateInput,
    repository,
    rpc,
    transactionHashes: { fixtureToken: TOKEN_TX, receivables: RECEIVABLES_TX }
  });

test("builds a clean-head, offline-rebuilt candidate with exact CREATE order", async () => {
  const repository = makeRepository();
  const built = await buildFixtureDeploymentCandidate({
    repository,
    deployer: DEPLOYER,
    owner: OWNER,
    underwriter: UNDERWRITER,
    startingNonce: 7n
  });
  assert.equal(repository.calls.rebuild, 1);
  assert.equal(built.schemaVersion, FIXTURE_DEPLOYMENT_SCHEMA);
  assert.equal(built.deployments.fixtureToken.nonce, "7");
  assert.equal(built.deployments.receivables.nonce, "8");
  assert.equal(built.deployments.receivables.constructorArguments[0], built.deployments.fixtureToken.address);
  assert.equal(built.disclosures.fixtureNoValue, true);
  assert.equal(built.disclosures.networkDeploymentConfirmed, false);
  assert.match(built.candidateHash, /^0x[0-9a-f]{64}$/);
});

test("confirms exact chain receipts, runtimes, canonical blocks, and getters", async () => {
  const result = await verify(makeRpc());
  assert.equal(result.schemaVersion, FIXTURE_VERIFICATION_SCHEMA);
  assert.equal(result.disclosures.singleInjectedRpc, true);
  assert.equal(result.disclosures.independentlyVerified, false);
  assert.equal(result.disclosures.explorerSourceVerified, false);
  assert.equal(result.disclosures.submissionReady, false);
  assert.equal(result.assertions.exactCreationInputsAndCreateAddresses, true);
  assert.equal(result.deployments.fixtureToken.confirmations, "13");
  assert.equal(result.deployments.receivables.confirmations, "12");
  assert.equal(result.getters.fixtureToken.initialTotalSupply, "0");
  assert.match(result.reportHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(numericLeafPaths(result), []);
});

test("rejects source drift and constructor candidate tampering", async () => {
  const dirtyRepository = makeRepository({ status: " M contracts/src/OpenBellReceivables.sol\n" });
  await assert.rejects(
    buildFixtureDeploymentCandidate({
      repository: dirtyRepository,
      deployer: DEPLOYER,
      owner: OWNER,
      underwriter: UNDERWRITER,
      startingNonce: 7n
    }),
    /SOURCE_TREE_NOT_CLEAN/
  );
  await assert.rejects(
    buildFixtureDeploymentCandidate({
      repository: makeRepository({
        source: async (path) =>
          path === "contracts/src/OpenBellReceivables.sol"
            ? Buffer.from("source drift")
            : await readFile(resolve(repositoryRoot, path))
      }),
      deployer: DEPLOYER,
      owner: OWNER,
      underwriter: UNDERWRITER,
      startingNonce: 7n
    }),
    /SOURCE_BYTES_DRIFT:contracts\/src\/OpenBellReceivables\.sol/
  );

  const tampered = clone(candidate);
  tampered.deployments.receivables.creationInput = `0x${
    tampered.deployments.receivables.creationInput.slice(2, 4) === "00" ? "01" : "00"
  }${tampered.deployments.receivables.creationInput.slice(4)}`;
  await assert.rejects(verify(makeRpc(), tampered), /CANDIDATE_ARTIFACT_OR_CONSTRUCTOR_DRIFT/);
});

test("rejects wrong chain, low confirmations, and failed receipts", async () => {
  await assert.rejects(verify(makeRpc((state) => (state.chainId = 196n))), /WRONG_RPC_CHAIN/);
  await assert.rejects(verify(makeRpc((state) => (state.tip = 111n))), /RECEIVABLES_CONFIRMATIONS_TOO_LOW/);
  await assert.rejects(
    verify(makeRpc((state) => (state.receipts[RECEIVABLES_TX].status = "reverted"))),
    /DEPLOYMENT_RECEIPT_FAILED/
  );
});

test("rejects wrong sender, initcode, receipt address, and inclusion index", async () => {
  await assert.rejects(
    verify(makeRpc((state) => (state.transactions[RECEIVABLES_TX].from = OWNER))),
    /WRONG_TRANSACTION_SENDER/
  );
  await assert.rejects(
    verify(makeRpc((state) => (state.transactions[RECEIVABLES_TX].input = "0x1234"))),
    /WRONG_CREATION_INPUT/
  );
  await assert.rejects(
    verify(makeRpc((state) => (state.receipts[RECEIVABLES_TX].contractAddress = OWNER))),
    /WRONG_CONTRACT_ADDRESS/
  );
  await assert.rejects(
    verify(makeRpc((state) => (state.blocks["101"].transactions = [TOKEN_TX]))),
    /TRANSACTION_NOT_AT_RECEIPT_INDEX/
  );
  await assert.rejects(
    verify(
      makeRpc((state) => {
        state.transactions[TOKEN_TX].blockNumber = 101n;
        state.transactions[TOKEN_TX].blockHash = RECEIVABLES_BLOCK_HASH;
        state.transactions[TOKEN_TX].transactionIndex = 1n;
        state.receipts[TOKEN_TX].blockNumber = 101n;
        state.receipts[TOKEN_TX].blockHash = RECEIVABLES_BLOCK_HASH;
        state.receipts[TOKEN_TX].transactionIndex = 1n;
        state.blocks["101"].transactions = [RECEIVABLES_TX, TOKEN_TX];
      })
    ),
    /SAME_BLOCK_DEPLOYMENT_ORDER_REVERSED/
  );
});

test("rejects runtime drift outside immutable spans", async () => {
  await assert.rejects(
    verify(
      makeRpc((state) => {
        state.receivablesCode = `0x${state.receivablesCode.slice(2, 4) === "00" ? "01" : "00"}${state.receivablesCode.slice(4)}`;
      })
    ),
    /RECEIVABLES_RUNTIME_TEMPLATE_DRIFT/
  );

  const references = receivablesArtifact.deployedBytecode.immutableReferences;
  const repeatedEntry = Object.values(references).find((locations) => locations.length > 1);
  assert.ok(repeatedEntry);
  await assert.rejects(
    verify(
      makeRpc((state) => {
        state.receivablesCode = mutateRuntimeByte(state.receivablesCode, repeatedEntry[0].start);
      })
    ),
    /RECEIVABLES_INCONSISTENT_IMMUTABLE/
  );

  const rpc = makeRpc((state) => {
    for (const location of repeatedEntry) {
      state.receivablesCode = mutateRuntimeByte(state.receivablesCode, location.start, "03");
    }
  });
  const verified = await verify(rpc);
  assert.equal(verified.assertions.sourceArtifactRuntimeBinding, true);
});

test("rejects getter and domain drift", async () => {
  await assert.rejects(
    verify(
      makeRpc((state) => {
        const encoded = functionResult(tokenArtifact, "totalSupply", 1n);
        state.calls.set(encoded.data, encoded.result);
      })
    ),
    /NONZERO_INITIAL_SUPPLY/
  );
  await assert.rejects(
    verify(
      makeRpc((state) => {
        const encoded = functionResult(receivablesArtifact, "underwriter", OWNER);
        state.calls.set(encoded.data, encoded.result);
      })
    ),
    /WRONG_UNDERWRITER/
  );
  await assert.rejects(
    verify(
      makeRpc((state) => {
        const encoded = functionResult(receivablesArtifact, "eip712Domain", [
          "0x0f",
          "OpenBell Receivables",
          "1",
          196n,
          candidate.deployments.receivables.address,
          `0x${"00".repeat(32)}`,
          []
        ]);
        state.calls.set(encoded.data, encoded.result);
      })
    ),
    /WRONG_EIP712_CHAIN/
  );
});

test("rejects canonical block changes on the final recheck", async () => {
  await assert.rejects(
    verify(
      makeRpc((state) => {
        state.blockMutation = (key, block) =>
          key === "101" ? { ...block, hash: `0x${"dd".repeat(32)}` } : block;
      })
    ),
    /RECEIVABLES_BLOCK_REORG/
  );

  await assert.rejects(
    verify(
      makeRpc((state) => {
        state.blocks["112"].number = 999n;
      })
    ),
    /PINNED_BLOCK_NUMBER_MISMATCH/
  );
});
