import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  hexToBytes,
  keccak256,
  toHex
} from "viem";

const execFile = promisify(execFileCallback);

export const FIXTURE_DEPLOYMENT_SCHEMA = "openbell-receivables-fixture-deployment-candidate-v1";
export const FIXTURE_VERIFICATION_SCHEMA = "openbell-receivables-fixture-deployment-verified-v1";
export const XLAYER_TESTNET_CHAIN_ID = 1_952n;
export const EIP170_RUNTIME_LIMIT = 24_576;

const TOKEN_ARTIFACT_PATH = "out/OpenBellTestUSDG.sol/OpenBellTestUSDG.json";
const RECEIVABLES_ARTIFACT_PATH = "out/OpenBellReceivables.sol/OpenBellReceivables.json";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

const POLICY = Object.freeze({
  maxAdvanceBps: 8_000n,
  maxFeeBps: 2_000n,
  maxRiskAge: 3_600n,
  maxInvoiceAge: 604_800n,
  maxInvoiceTenor: 7_776_000n
});

const fail = (message) => {
  throw new Error(`FIXTURE_DEPLOYMENT_VERIFICATION:${message}`);
};

const requireTrue = (condition, message) => {
  if (!condition) fail(message);
};

const canonicalAddress = (value, label) => {
  try {
    return getAddress(value);
  } catch {
    fail(`INVALID_${label.toUpperCase()}_ADDRESS`);
  }
};

const canonicalHex = (value, bytes, label) => {
  requireTrue(typeof value === "string" && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value), `INVALID_${label.toUpperCase()}`);
  return value.toLowerCase();
};

const bigint = (value, label) => {
  try {
    const parsed = BigInt(value);
    requireTrue(parsed >= 0n, `NEGATIVE_${label.toUpperCase()}`);
    return parsed;
  } catch {
    fail(`INVALID_${label.toUpperCase()}`);
  }
};

const sha256 = (value) => `0x${createHash("sha256").update(value).digest("hex")}`;

const canonicalJson = (value) => {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const hashObject = (value) => sha256(canonicalJson(value));

const artifactObject = (text, target, label) => {
  let artifact;
  try {
    artifact = JSON.parse(text);
  } catch {
    fail(`INVALID_${label.toUpperCase()}_ARTIFACT_JSON`);
  }
  requireTrue(Array.isArray(artifact.abi), `${label.toUpperCase()}_ABI_MISSING`);
  requireTrue(/^0x[0-9a-fA-F]+$/.test(artifact.bytecode?.object ?? ""), `${label.toUpperCase()}_CREATION_CODE_MISSING`);
  requireTrue(/^0x[0-9a-fA-F]+$/.test(artifact.deployedBytecode?.object ?? ""), `${label.toUpperCase()}_RUNTIME_MISSING`);
  requireTrue(Object.keys(artifact.bytecode.linkReferences ?? {}).length === 0, `${label.toUpperCase()}_CREATION_LINKS_PRESENT`);
  requireTrue(Object.keys(artifact.deployedBytecode.linkReferences ?? {}).length === 0, `${label.toUpperCase()}_RUNTIME_LINKS_PRESENT`);

  const metadata = artifact.metadata;
  requireTrue(metadata?.compiler?.version === "0.8.30+commit.73712a01", `${label.toUpperCase()}_WRONG_SOLC`);
  requireTrue(metadata?.settings?.evmVersion === "prague", `${label.toUpperCase()}_WRONG_EVM_TARGET`);
  requireTrue(metadata?.settings?.optimizer?.enabled === true, `${label.toUpperCase()}_OPTIMIZER_DISABLED`);
  requireTrue(metadata?.settings?.optimizer?.runs === 10_000, `${label.toUpperCase()}_WRONG_OPTIMIZER_RUNS`);
  requireTrue(metadata?.settings?.compilationTarget?.[target] !== undefined, `${label.toUpperCase()}_WRONG_TARGET`);
  requireTrue(Object.keys(metadata?.sources ?? {}).length > 0, `${label.toUpperCase()}_SOURCES_MISSING`);
  for (const source of Object.values(metadata.sources)) {
    requireTrue(/^0x[0-9a-f]{64}$/.test(source?.keccak256 ?? ""), `${label.toUpperCase()}_SOURCE_HASH_MISSING`);
  }

  const creation = artifact.bytecode.object.toLowerCase();
  const runtime = artifact.deployedBytecode.object.toLowerCase();
  const runtimeBytes = hexToBytes(runtime).length;
  requireTrue(runtimeBytes > 0 && runtimeBytes <= EIP170_RUNTIME_LIMIT, `${label.toUpperCase()}_RUNTIME_SIZE`);
  return { artifact, creation, runtime, runtimeBytes };
};

const artifactCommitment = (text, parsed) => ({
  artifactSha256: sha256(text),
  creationCodeHash: keccak256(parsed.creation),
  creationByteLength: String(hexToBytes(parsed.creation).length),
  runtimeTemplateHash: keccak256(parsed.runtime),
  runtimeByteLength: String(parsed.runtimeBytes),
  compiler: "0.8.30+commit.73712a01",
  evmVersion: "prague",
  optimizerRuns: "10000",
  sourceHashes: Object.entries(parsed.artifact.metadata.sources ?? {})
    .map(([path, source]) => ({ path, keccak256: source.keccak256 }))
    .sort((left, right) => left.path.localeCompare(right.path))
});

const makeCandidate = ({
  sourceCommit,
  deployer,
  owner,
  underwriter,
  startingNonce,
  tokenArtifactText,
  receivablesArtifactText
}) => {
  requireTrue(/^[0-9a-f]{40}$/.test(sourceCommit), "INVALID_SOURCE_COMMIT");
  const canonicalDeployer = canonicalAddress(deployer, "deployer");
  const canonicalOwner = canonicalAddress(owner, "owner");
  const canonicalUnderwriter = canonicalAddress(underwriter, "underwriter");
  requireTrue(canonicalDeployer !== ZERO_ADDRESS, "ZERO_DEPLOYER");
  requireTrue(canonicalOwner !== ZERO_ADDRESS, "ZERO_OWNER");
  requireTrue(canonicalUnderwriter !== ZERO_ADDRESS, "ZERO_UNDERWRITER");
  requireTrue(canonicalOwner !== canonicalUnderwriter, "OWNER_EQUALS_UNDERWRITER");
  const firstNonce = bigint(startingNonce, "starting_nonce");

  const token = artifactObject(
    tokenArtifactText,
    "contracts/src/mocks/OpenBellTestUSDG.sol",
    "fixture_token"
  );
  const receivables = artifactObject(
    receivablesArtifactText,
    "contracts/src/OpenBellReceivables.sol",
    "receivables"
  );
  const tokenAddress = getContractAddress({ from: canonicalDeployer, nonce: firstNonce });
  const receivablesAddress = getContractAddress({ from: canonicalDeployer, nonce: firstNonce + 1n });
  const tokenCreationInput = encodeDeployData({ abi: token.artifact.abi, bytecode: token.creation });
  const constructorArguments = [
    tokenAddress,
    canonicalOwner,
    canonicalUnderwriter,
    POLICY.maxAdvanceBps,
    POLICY.maxFeeBps,
    POLICY.maxRiskAge,
    POLICY.maxInvoiceAge,
    POLICY.maxInvoiceTenor
  ];
  const receivablesCreationInput = encodeDeployData({
    abi: receivables.artifact.abi,
    bytecode: receivables.creation,
    args: constructorArguments
  });

  const body = {
    schemaVersion: FIXTURE_DEPLOYMENT_SCHEMA,
    disclosures: {
      fixtureNoValue: true,
      canonicalUsdG: false,
      realValue: false,
      liveModel: false,
      networkDeploymentConfirmed: false,
      independentlyVerified: false,
      explorerSourceVerified: false,
      submissionReady: false
    },
    source: {
      commit: sourceCommit,
      cleanHeadRebuiltOffline: true,
      metadataSourceBytesVerified: true,
      artifactPaths: {
        fixtureToken: TOKEN_ARTIFACT_PATH,
        receivables: RECEIVABLES_ARTIFACT_PATH
      }
    },
    chainId: String(XLAYER_TESTNET_CHAIN_ID),
    roles: { deployer: canonicalDeployer, owner: canonicalOwner, underwriter: canonicalUnderwriter },
    policy: Object.fromEntries(Object.entries(POLICY).map(([key, value]) => [key, value.toString()])),
    artifacts: {
      fixtureToken: artifactCommitment(tokenArtifactText, token),
      receivables: artifactCommitment(receivablesArtifactText, receivables)
    },
    deployments: {
      fixtureToken: {
        nonce: firstNonce.toString(),
        address: tokenAddress,
        creationInput: tokenCreationInput,
        constructorArguments: []
      },
      receivables: {
        nonce: (firstNonce + 1n).toString(),
        address: receivablesAddress,
        creationInput: receivablesCreationInput,
        constructorArguments: constructorArguments.map((value) =>
          typeof value === "bigint" ? value.toString() : value
        )
      }
    }
  };
  return { ...body, candidateHash: hashObject(body) };
};

export const createRepositoryAdapter = (repositoryRoot) => ({
  async head() {
    return (await execFile("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })).stdout.trim();
  },
  async status() {
    return (
      await execFile(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"],
        { cwd: repositoryRoot }
      )
    ).stdout;
  },
  async submodules() {
    return (await execFile("git", ["submodule", "status", "--recursive"], { cwd: repositoryRoot })).stdout;
  },
  async rebuildOffline() {
    await execFile("forge", ["build", "--offline", "--force", "--quiet"], { cwd: repositoryRoot });
  },
  async artifact(path) {
    return await readFile(resolve(repositoryRoot, path), "utf8");
  },
  async source(path) {
    return await readFile(resolve(repositoryRoot, path));
  }
});

const loadCleanBuild = async (repository, expectedCommit) => {
  requireTrue(repository && typeof repository === "object", "REPOSITORY_ADAPTER_REQUIRED");
  const headBefore = (await repository.head()).trim();
  if (expectedCommit !== undefined) requireTrue(headBefore === expectedCommit, "SOURCE_COMMIT_MISMATCH");
  requireTrue((await repository.status()) === "", "SOURCE_TREE_NOT_CLEAN");
  const submodulesBefore = await repository.submodules();
  requireTrue(!submodulesBefore.split("\n").filter(Boolean).some((line) => /^[+\-U]/.test(line)), "SUBMODULE_NOT_PINNED");
  await repository.rebuildOffline();
  const headAfter = (await repository.head()).trim();
  requireTrue(headAfter === headBefore, "SOURCE_HEAD_CHANGED_DURING_BUILD");
  requireTrue((await repository.status()) === "", "SOURCE_TREE_CHANGED_DURING_BUILD");
  requireTrue((await repository.submodules()) === submodulesBefore, "SUBMODULE_CHANGED_DURING_BUILD");
  const [tokenArtifactText, receivablesArtifactText] = await Promise.all([
    repository.artifact(TOKEN_ARTIFACT_PATH),
    repository.artifact(RECEIVABLES_ARTIFACT_PATH)
  ]);
  const token = artifactObject(
    tokenArtifactText,
    "contracts/src/mocks/OpenBellTestUSDG.sol",
    "fixture_token"
  );
  const receivables = artifactObject(
    receivablesArtifactText,
    "contracts/src/OpenBellReceivables.sol",
    "receivables"
  );
  const sourceEntries = new Map();
  for (const artifact of [token.artifact, receivables.artifact]) {
    for (const [path, source] of Object.entries(artifact.metadata.sources ?? {})) {
      if (sourceEntries.has(path)) {
        requireTrue(sourceEntries.get(path) === source.keccak256, "CONFLICTING_METADATA_SOURCE_HASH");
      } else {
        sourceEntries.set(path, source.keccak256);
      }
    }
  }
  for (const [path, expectedHash] of [...sourceEntries].sort(([left], [right]) => left.localeCompare(right))) {
    const sourceBytes = new Uint8Array(await repository.source(path));
    requireTrue(keccak256(toHex(sourceBytes)) === expectedHash, `SOURCE_BYTES_DRIFT:${path}`);
  }
  requireTrue((await repository.head()).trim() === headBefore, "SOURCE_HEAD_CHANGED_DURING_READBACK");
  requireTrue((await repository.status()) === "", "SOURCE_TREE_CHANGED_DURING_READBACK");
  requireTrue((await repository.submodules()) === submodulesBefore, "SUBMODULE_CHANGED_DURING_READBACK");
  return { head: headBefore, submodules: submodulesBefore, tokenArtifactText, receivablesArtifactText };
};

export const buildFixtureDeploymentCandidate = async ({
  repository,
  deployer,
  owner,
  underwriter,
  startingNonce
}) => {
  const { head, tokenArtifactText, receivablesArtifactText } = await loadCleanBuild(repository);
  return makeCandidate({
    sourceCommit: head,
    deployer,
    owner,
    underwriter,
    startingNonce,
    tokenArtifactText,
    receivablesArtifactText
  });
};

const assertCandidate = (candidate, tokenArtifactText, receivablesArtifactText) => {
  requireTrue(candidate?.schemaVersion === FIXTURE_DEPLOYMENT_SCHEMA, "WRONG_CANDIDATE_SCHEMA");
  requireTrue(candidate.disclosures?.fixtureNoValue === true, "FIXTURE_DISCLOSURE_MISSING");
  requireTrue(candidate.disclosures?.canonicalUsdG === false, "CANONICAL_USDG_OVERCLAIM");
  requireTrue(candidate.disclosures?.networkDeploymentConfirmed === false, "CANDIDATE_NETWORK_OVERCLAIM");
  const rebuilt = makeCandidate({
    sourceCommit: candidate.source?.commit,
    deployer: candidate.roles?.deployer,
    owner: candidate.roles?.owner,
    underwriter: candidate.roles?.underwriter,
    startingNonce: candidate.deployments?.fixtureToken?.nonce,
    tokenArtifactText,
    receivablesArtifactText
  });
  requireTrue(canonicalJson(rebuilt) === canonicalJson(candidate), "CANDIDATE_ARTIFACT_OR_CONSTRUCTOR_DRIFT");
  return {
    token: artifactObject(tokenArtifactText, "contracts/src/mocks/OpenBellTestUSDG.sol", "fixture_token"),
    receivables: artifactObject(receivablesArtifactText, "contracts/src/OpenBellReceivables.sol", "receivables")
  };
};

const sameAddress = (left, right) => canonicalAddress(left, "observed") === canonicalAddress(right, "expected");

const successStatus = (status) =>
  status === "success" || status === "0x1" || status === 1 || status === 1n;

const transactionHashAt = (block, index) => {
  const item = block.transactions?.[index];
  return typeof item === "string" ? item : item?.hash;
};

const validateTransaction = ({ transaction, receipt, block, expected, chainId }) => {
  requireTrue(canonicalHex(transaction.hash, 32, "transaction_hash") === expected.transactionHash, "TRANSACTION_HASH_MISMATCH");
  requireTrue(sameAddress(transaction.from, expected.deployer), "WRONG_TRANSACTION_SENDER");
  requireTrue(transaction.to === null || transaction.to === undefined, "DEPLOYMENT_TRANSACTION_HAS_TO");
  requireTrue((transaction.input ?? transaction.data)?.toLowerCase() === expected.creationInput.toLowerCase(), "WRONG_CREATION_INPUT");
  requireTrue(bigint(transaction.value ?? 0n, "transaction_value") === 0n, "NONZERO_TRANSACTION_VALUE");
  requireTrue(bigint(transaction.nonce, "transaction_nonce") === expected.nonce, "WRONG_TRANSACTION_NONCE");
  requireTrue(bigint(transaction.chainId, "transaction_chain") === chainId, "WRONG_TRANSACTION_CHAIN");
  requireTrue(bigint(transaction.blockNumber, "transaction_block") === expected.blockNumber, "TRANSACTION_BLOCK_MISMATCH");
  requireTrue(canonicalHex(transaction.blockHash, 32, "transaction_block_hash") === expected.blockHash, "TRANSACTION_BLOCK_HASH_MISMATCH");
  requireTrue(bigint(transaction.transactionIndex, "transaction_index") === expected.transactionIndex, "TRANSACTION_INDEX_MISMATCH");

  requireTrue(canonicalHex(receipt.transactionHash, 32, "receipt_transaction_hash") === expected.transactionHash, "RECEIPT_TRANSACTION_MISMATCH");
  requireTrue(successStatus(receipt.status), "DEPLOYMENT_RECEIPT_FAILED");
  requireTrue(sameAddress(receipt.from, expected.deployer), "WRONG_RECEIPT_SENDER");
  requireTrue(receipt.to === null || receipt.to === undefined, "DEPLOYMENT_RECEIPT_HAS_TO");
  requireTrue(sameAddress(receipt.contractAddress, expected.contractAddress), "WRONG_CONTRACT_ADDRESS");
  requireTrue(bigint(receipt.blockNumber, "receipt_block") === expected.blockNumber, "RECEIPT_BLOCK_MISMATCH");
  requireTrue(canonicalHex(receipt.blockHash, 32, "receipt_block_hash") === expected.blockHash, "RECEIPT_BLOCK_HASH_MISMATCH");
  requireTrue(bigint(receipt.transactionIndex, "receipt_transaction_index") === expected.transactionIndex, "RECEIPT_INDEX_MISMATCH");
  requireTrue(bigint(receipt.gasUsed, "receipt_gas") > 0n, "ZERO_RECEIPT_GAS");

  requireTrue(bigint(block.number, "block_number") === expected.blockNumber, "BLOCK_NUMBER_MISMATCH");
  requireTrue(canonicalHex(block.hash, 32, "block_hash") === expected.blockHash, "BLOCK_HASH_MISMATCH");
  requireTrue(
    canonicalHex(transactionHashAt(block, Number(expected.transactionIndex)), 32, "included_transaction") ===
      expected.transactionHash,
    "TRANSACTION_NOT_AT_RECEIPT_INDEX"
  );
};

const immutableRanges = (references, runtimeLength) => {
  requireTrue(references && typeof references === "object" && !Array.isArray(references), "INVALID_IMMUTABLE_MAP");
  const ranges = [];
  for (const [identifier, locations] of Object.entries(references)) {
    requireTrue(/^\d+$/.test(identifier) && Array.isArray(locations) && locations.length > 0, "INVALID_IMMUTABLE_ENTRY");
    for (const location of locations) {
      const start = Number(location?.start);
      const length = Number(location?.length);
      requireTrue(Number.isSafeInteger(start) && start >= 0, "INVALID_IMMUTABLE_START");
      requireTrue(Number.isSafeInteger(length) && length > 0, "INVALID_IMMUTABLE_LENGTH");
      requireTrue(start + length <= runtimeLength, "IMMUTABLE_RANGE_OUT_OF_BOUNDS");
      ranges.push({ identifier, start, end: start + length });
    }
  }
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < sorted.length; index += 1) {
    requireTrue(sorted[index - 1].end <= sorted[index].start, "OVERLAPPING_IMMUTABLE_RANGES");
  }
  return ranges;
};

const assertRuntime = (observed, template, references, label) => {
  requireTrue(/^0x[0-9a-fA-F]+$/.test(observed ?? ""), `${label.toUpperCase()}_CODE_MISSING`);
  const observedBytes = hexToBytes(observed);
  const templateBytes = hexToBytes(template);
  requireTrue(observedBytes.length === templateBytes.length, `${label.toUpperCase()}_RUNTIME_LENGTH`);
  requireTrue(observedBytes.length <= EIP170_RUNTIME_LIMIT, `${label.toUpperCase()}_EIP170`);
  const ranges = Object.keys(references ?? {}).length === 0 ? [] : immutableRanges(references, observedBytes.length);
  const immutableValues = new Map();
  for (const range of ranges) {
    const value = Buffer.from(observedBytes.slice(range.start, range.end)).toString("hex");
    if (immutableValues.has(range.identifier)) {
      requireTrue(immutableValues.get(range.identifier) === value, `${label.toUpperCase()}_INCONSISTENT_IMMUTABLE`);
    } else {
      immutableValues.set(range.identifier, value);
    }
  }
  for (let index = 0; index < observedBytes.length; index += 1) {
    if (ranges.some(({ start, end }) => index >= start && index < end)) continue;
    requireTrue(observedBytes[index] === templateBytes[index], `${label.toUpperCase()}_RUNTIME_TEMPLATE_DRIFT`);
  }
  return { byteLength: String(observedBytes.length), codeHash: keccak256(observed) };
};

const readFunction = async ({ rpc, address, abi, functionName, blockNumber }) => {
  const data = encodeFunctionData({ abi, functionName });
  const result = await rpc.call({ to: address, data, blockNumber });
  return decodeFunctionResult({ abi, functionName, data: result });
};

const assertGetters = async ({ rpc, candidate, tokenArtifact, receivablesArtifact, blockNumber }) => {
  const tokenAddress = candidate.deployments.fixtureToken.address;
  const receivablesAddress = candidate.deployments.receivables.address;
  const tokenRead = (functionName) =>
    readFunction({ rpc, address: tokenAddress, abi: tokenArtifact.abi, functionName, blockNumber });
  const receivablesRead = (functionName) =>
    readFunction({ rpc, address: receivablesAddress, abi: receivablesArtifact.abi, functionName, blockNumber });

  const [name, symbol, decimals, faucetAmount, totalSupply] = await Promise.all([
    tokenRead("name"),
    tokenRead("symbol"),
    tokenRead("decimals"),
    tokenRead("FAUCET_AMOUNT"),
    tokenRead("totalSupply")
  ]);
  requireTrue(name === "OpenBell Test USDG (Fixture)", "WRONG_FIXTURE_TOKEN_NAME");
  requireTrue(symbol === "tUSDG", "WRONG_FIXTURE_TOKEN_SYMBOL");
  requireTrue(bigint(decimals, "token_decimals") === 6n, "WRONG_FIXTURE_TOKEN_DECIMALS");
  requireTrue(bigint(faucetAmount, "faucet_amount") === 1_000_000_000n, "WRONG_FIXTURE_FAUCET_AMOUNT");
  requireTrue(bigint(totalSupply, "total_supply") === 0n, "NONZERO_INITIAL_SUPPLY");

  const [
    settlement,
    owner,
    pendingOwner,
    underwriter,
    paused,
    bps,
    maxAdvance,
    maxFee,
    maxRiskAge,
    maxInvoiceAge,
    maxInvoiceTenor,
    invoiceTypehash,
    approvalTypehash,
    rejectionTypehash,
    domain
  ] =
    await Promise.all([
      receivablesRead("settlementToken"),
      receivablesRead("owner"),
      receivablesRead("pendingOwner"),
      receivablesRead("underwriter"),
      receivablesRead("paused"),
      receivablesRead("BPS"),
      receivablesRead("maxAdvanceBps"),
      receivablesRead("maxFeeBps"),
      receivablesRead("maxRiskAge"),
      receivablesRead("maxInvoiceAge"),
      receivablesRead("maxInvoiceTenor"),
      receivablesRead("INVOICE_TYPEHASH"),
      receivablesRead("APPROVAL_TYPEHASH"),
      receivablesRead("REJECTION_TYPEHASH"),
      receivablesRead("eip712Domain")
    ]);
  requireTrue(sameAddress(settlement, tokenAddress), "WRONG_SETTLEMENT_TOKEN");
  requireTrue(sameAddress(owner, candidate.roles.owner), "WRONG_OWNER");
  requireTrue(sameAddress(pendingOwner, ZERO_ADDRESS), "NONZERO_PENDING_OWNER");
  requireTrue(sameAddress(underwriter, candidate.roles.underwriter), "WRONG_UNDERWRITER");
  requireTrue(paused === false, "RECEIVABLES_PAUSED");
  requireTrue(bigint(bps, "bps") === 10_000n, "WRONG_BPS");
  requireTrue(bigint(maxAdvance, "max_advance") === POLICY.maxAdvanceBps, "WRONG_MAX_ADVANCE");
  requireTrue(bigint(maxFee, "max_fee") === POLICY.maxFeeBps, "WRONG_MAX_FEE");
  requireTrue(bigint(maxRiskAge, "max_risk_age") === POLICY.maxRiskAge, "WRONG_MAX_RISK_AGE");
  requireTrue(bigint(maxInvoiceAge, "max_invoice_age") === POLICY.maxInvoiceAge, "WRONG_MAX_INVOICE_AGE");
  requireTrue(bigint(maxInvoiceTenor, "max_invoice_tenor") === POLICY.maxInvoiceTenor, "WRONG_MAX_INVOICE_TENOR");
  requireTrue(
    invoiceTypehash === "0x3fa7362141ca2043801d61b9efee211fcbc943d3c40221f3ef30e1c50e933686",
    "WRONG_INVOICE_TYPEHASH"
  );
  requireTrue(
    approvalTypehash === "0x0237a21cd055f0c6cd3ddb0b019ef5b9df26dcd8f5ddeaa837de0477b1d7be2f",
    "WRONG_APPROVAL_TYPEHASH"
  );
  requireTrue(
    rejectionTypehash === "0xc37ca47ab045a2d5cbd3c6754a2261ef43266e00880b7d707bc3daef81dd9a65",
    "WRONG_REJECTION_TYPEHASH"
  );
  requireTrue(Array.isArray(domain) && domain.length === 7, "INVALID_EIP712_DOMAIN");
  requireTrue(domain[0] === "0x0f", "WRONG_EIP712_FIELDS");
  requireTrue(domain[1] === "OpenBell Receivables" && domain[2] === "1", "WRONG_EIP712_NAME_VERSION");
  requireTrue(bigint(domain[3], "domain_chain") === XLAYER_TESTNET_CHAIN_ID, "WRONG_EIP712_CHAIN");
  requireTrue(sameAddress(domain[4], receivablesAddress), "WRONG_EIP712_CONTRACT");
  requireTrue(domain[5] === ZERO_BYTES32 && Array.isArray(domain[6]) && domain[6].length === 0, "UNEXPECTED_EIP712_EXTENSION");

  return {
    fixtureToken: { name, symbol, decimals: "6", faucetAmount: "1000000000", initialTotalSupply: "0" },
    receivables: {
      settlementToken: getAddress(settlement),
      owner: getAddress(owner),
      pendingOwner: getAddress(pendingOwner),
      underwriter: getAddress(underwriter),
      paused: false,
      bps: "10000",
      maxAdvanceBps: POLICY.maxAdvanceBps.toString(),
      maxFeeBps: POLICY.maxFeeBps.toString(),
      maxRiskAge: POLICY.maxRiskAge.toString(),
      maxInvoiceAge: POLICY.maxInvoiceAge.toString(),
      maxInvoiceTenor: POLICY.maxInvoiceTenor.toString(),
      invoiceTypehash,
      approvalTypehash,
      rejectionTypehash,
      eip712Domain: {
        fields: domain[0],
        name: domain[1],
        version: domain[2],
        chainId: String(domain[3]),
        verifyingContract: getAddress(domain[4]),
        salt: domain[5],
        extensions: domain[6].map(String)
      }
    }
  };
};

export const verifyFixtureDeployment = async ({
  candidate,
  repository,
  rpc,
  transactionHashes,
  minimumConfirmations = 12n
}) => {
  requireTrue(rpc && typeof rpc === "object", "READ_ONLY_RPC_REQUIRED");
  for (const method of [
    "chainId",
    "blockNumber",
    "transaction",
    "receipt",
    "block",
    "blockByHash",
    "code",
    "call"
  ]) {
    requireTrue(typeof rpc[method] === "function", `RPC_${method.toUpperCase()}_REQUIRED`);
  }
  const { submodules, tokenArtifactText, receivablesArtifactText } = await loadCleanBuild(
    repository,
    candidate?.source?.commit
  );
  const artifacts = assertCandidate(candidate, tokenArtifactText, receivablesArtifactText);
  const chainId = bigint(await rpc.chainId(), "rpc_chain");
  requireTrue(chainId === XLAYER_TESTNET_CHAIN_ID, "WRONG_RPC_CHAIN");
  const confirmationsRequired = bigint(minimumConfirmations, "minimum_confirmations");
  requireTrue(confirmationsRequired >= 12n, "CONFIRMATION_FLOOR_BELOW_12");
  const tokenHash = canonicalHex(transactionHashes?.fixtureToken, 32, "fixture_token_transaction");
  const receivablesHash = canonicalHex(transactionHashes?.receivables, 32, "receivables_transaction");
  requireTrue(tokenHash !== receivablesHash, "DUPLICATE_DEPLOYMENT_TRANSACTION");

  const latestBefore = bigint(await rpc.blockNumber(), "latest_block");
  const [tokenTransaction, tokenReceipt, receivablesTransaction, receivablesReceipt] = await Promise.all([
    rpc.transaction(tokenHash),
    rpc.receipt(tokenHash),
    rpc.transaction(receivablesHash),
    rpc.receipt(receivablesHash)
  ]);
  requireTrue(tokenTransaction && tokenReceipt && receivablesTransaction && receivablesReceipt, "DEPLOYMENT_NOT_MINED");

  const tokenBlockNumber = bigint(tokenReceipt.blockNumber, "token_block_number");
  const receivablesBlockNumber = bigint(receivablesReceipt.blockNumber, "receivables_block_number");
  requireTrue(tokenBlockNumber <= receivablesBlockNumber, "DEPLOYMENT_ORDER_REVERSED");
  if (tokenBlockNumber === receivablesBlockNumber) {
    requireTrue(
      bigint(tokenReceipt.transactionIndex, "token_same_block_index") <
        bigint(receivablesReceipt.transactionIndex, "receivables_same_block_index"),
      "SAME_BLOCK_DEPLOYMENT_ORDER_REVERSED"
    );
  }
  requireTrue(latestBefore >= receivablesBlockNumber, "TIP_BEFORE_DEPLOYMENT");
  requireTrue(latestBefore - tokenBlockNumber + 1n >= confirmationsRequired, "TOKEN_CONFIRMATIONS_TOO_LOW");
  requireTrue(latestBefore - receivablesBlockNumber + 1n >= confirmationsRequired, "RECEIVABLES_CONFIRMATIONS_TOO_LOW");
  const [tokenBlock, receivablesBlock, pinnedBlock] = await Promise.all([
    rpc.block(tokenBlockNumber),
    rpc.block(receivablesBlockNumber),
    rpc.block(latestBefore)
  ]);
  requireTrue(tokenBlock && receivablesBlock && pinnedBlock, "BLOCK_NOT_FOUND");
  requireTrue(bigint(pinnedBlock.number, "pinned_block_number") === latestBefore, "PINNED_BLOCK_NUMBER_MISMATCH");
  const [tokenBlockByHash, receivablesBlockByHash, pinnedBlockByHash] = await Promise.all([
    rpc.blockByHash(tokenBlock.hash),
    rpc.blockByHash(receivablesBlock.hash),
    rpc.blockByHash(pinnedBlock.hash)
  ]);
  requireTrue(canonicalJson(tokenBlockByHash) === canonicalJson(tokenBlock), "TOKEN_BLOCK_NUMBER_HASH_SPLIT");
  requireTrue(
    canonicalJson(receivablesBlockByHash) === canonicalJson(receivablesBlock),
    "RECEIVABLES_BLOCK_NUMBER_HASH_SPLIT"
  );
  requireTrue(canonicalJson(pinnedBlockByHash) === canonicalJson(pinnedBlock), "PINNED_BLOCK_NUMBER_HASH_SPLIT");

  const tokenExpected = {
    transactionHash: tokenHash,
    deployer: candidate.roles.deployer,
    creationInput: candidate.deployments.fixtureToken.creationInput,
    nonce: bigint(candidate.deployments.fixtureToken.nonce, "token_candidate_nonce"),
    contractAddress: candidate.deployments.fixtureToken.address,
    blockNumber: tokenBlockNumber,
    blockHash: canonicalHex(tokenReceipt.blockHash, 32, "token_receipt_block_hash"),
    transactionIndex: bigint(tokenReceipt.transactionIndex, "token_receipt_index")
  };
  const receivablesExpected = {
    transactionHash: receivablesHash,
    deployer: candidate.roles.deployer,
    creationInput: candidate.deployments.receivables.creationInput,
    nonce: bigint(candidate.deployments.receivables.nonce, "receivables_candidate_nonce"),
    contractAddress: candidate.deployments.receivables.address,
    blockNumber: receivablesBlockNumber,
    blockHash: canonicalHex(receivablesReceipt.blockHash, 32, "receivables_receipt_block_hash"),
    transactionIndex: bigint(receivablesReceipt.transactionIndex, "receivables_receipt_index")
  };
  requireTrue(receivablesExpected.nonce === tokenExpected.nonce + 1n, "DEPLOYER_NONCES_NOT_CONSECUTIVE");
  validateTransaction({ transaction: tokenTransaction, receipt: tokenReceipt, block: tokenBlock, expected: tokenExpected, chainId });
  validateTransaction({
    transaction: receivablesTransaction,
    receipt: receivablesReceipt,
    block: receivablesBlock,
    expected: receivablesExpected,
    chainId
  });

  const [tokenCode, receivablesCode] = await Promise.all([
    rpc.code(candidate.deployments.fixtureToken.address, latestBefore),
    rpc.code(candidate.deployments.receivables.address, latestBefore)
  ]);
  const tokenRuntime = assertRuntime(tokenCode, artifacts.token.runtime, {}, "fixture_token");
  const receivablesRuntime = assertRuntime(
    receivablesCode,
    artifacts.receivables.runtime,
    artifacts.receivables.artifact.deployedBytecode.immutableReferences,
    "receivables"
  );
  const getters = await assertGetters({
    rpc,
    candidate,
    tokenArtifact: artifacts.token.artifact,
    receivablesArtifact: artifacts.receivables.artifact,
    blockNumber: latestBefore
  });

  const [tokenTransactionAgain, tokenReceiptAgain, receivablesTransactionAgain, receivablesReceiptAgain] =
    await Promise.all([
      rpc.transaction(tokenHash),
      rpc.receipt(tokenHash),
      rpc.transaction(receivablesHash),
      rpc.receipt(receivablesHash)
    ]);
  const [tokenBlockAgain, receivablesBlockAgain, pinnedBlockAgain] = await Promise.all([
    rpc.block(tokenBlockNumber),
    rpc.block(receivablesBlockNumber),
    rpc.block(latestBefore)
  ]);
  requireTrue(canonicalJson(tokenTransactionAgain) === canonicalJson(tokenTransaction), "TOKEN_TRANSACTION_CHANGED");
  requireTrue(canonicalJson(tokenReceiptAgain) === canonicalJson(tokenReceipt), "TOKEN_RECEIPT_CHANGED");
  requireTrue(
    canonicalJson(receivablesTransactionAgain) === canonicalJson(receivablesTransaction),
    "RECEIVABLES_TRANSACTION_CHANGED"
  );
  requireTrue(
    canonicalJson(receivablesReceiptAgain) === canonicalJson(receivablesReceipt),
    "RECEIVABLES_RECEIPT_CHANGED"
  );
  requireTrue(canonicalHex(tokenBlockAgain.hash, 32, "token_recheck_hash") === tokenExpected.blockHash, "TOKEN_BLOCK_REORG");
  requireTrue(
    canonicalHex(receivablesBlockAgain.hash, 32, "receivables_recheck_hash") === receivablesExpected.blockHash,
    "RECEIVABLES_BLOCK_REORG"
  );
  requireTrue(
    canonicalHex(pinnedBlockAgain.hash, 32, "pinned_recheck_hash") === canonicalHex(pinnedBlock.hash, 32, "pinned_hash"),
    "PINNED_BLOCK_REORG"
  );
  requireTrue(
    bigint(pinnedBlockAgain.number, "pinned_recheck_number") === latestBefore,
    "PINNED_BLOCK_NUMBER_CHANGED"
  );
  const latestAfter = bigint(await rpc.blockNumber(), "latest_block_after");
  requireTrue(latestAfter >= latestBefore, "RPC_TIP_REGRESSED");
  requireTrue((await repository.head()).trim() === candidate.source.commit, "SOURCE_HEAD_CHANGED_DURING_VERIFICATION");
  requireTrue((await repository.status()) === "", "SOURCE_TREE_CHANGED_DURING_VERIFICATION");
  requireTrue((await repository.submodules()) === submodules, "SUBMODULE_CHANGED_DURING_VERIFICATION");

  const result = {
    schemaVersion: FIXTURE_VERIFICATION_SCHEMA,
    disclosures: {
      fixtureNoValue: true,
      canonicalUsdG: false,
      realValue: false,
      liveModel: false,
      singleInjectedRpc: true,
      rpcTransactionsIndependentlyRefetched: true,
      independentlyVerified: false,
      explorerSourceVerified: false,
      submissionReady: false
    },
    candidateHash: candidate.candidateHash,
    sourceCommit: candidate.source.commit,
    chainId: chainId.toString(),
    confirmedAt: {
      blockNumber: latestBefore.toString(),
      blockHash: canonicalHex(pinnedBlock.hash, 32, "pinned_output_hash"),
      minimumConfirmations: confirmationsRequired.toString()
    },
    deployments: {
      fixtureToken: {
        address: candidate.deployments.fixtureToken.address,
        transactionHash: tokenHash,
        blockNumber: tokenBlockNumber.toString(),
        blockHash: tokenExpected.blockHash,
        confirmations: (latestBefore - tokenBlockNumber + 1n).toString(),
        gasUsed: bigint(tokenReceipt.gasUsed, "token_gas").toString(),
        runtime: tokenRuntime
      },
      receivables: {
        address: candidate.deployments.receivables.address,
        transactionHash: receivablesHash,
        blockNumber: receivablesBlockNumber.toString(),
        blockHash: receivablesExpected.blockHash,
        confirmations: (latestBefore - receivablesBlockNumber + 1n).toString(),
        gasUsed: bigint(receivablesReceipt.gasUsed, "receivables_gas").toString(),
        runtime: receivablesRuntime
      }
    },
    assertions: {
      cleanHeadOfflineBuildBound: true,
      exactCreationInputsAndCreateAddresses: true,
      exactTransactionsReceiptsAndInclusion: true,
      canonicalBlocksRechecked: true,
      sourceArtifactRuntimeBinding: true,
      eip170RuntimeLimits: true,
      exactFixtureAndReceivablesGetters: true
    },
    getters
  };
  return { ...result, reportHash: hashObject(result) };
};

export const fixtureDeploymentArtifactPaths = Object.freeze({
  fixtureToken: TOKEN_ARTIFACT_PATH,
  receivables: RECEIVABLES_ARTIFACT_PATH
});
