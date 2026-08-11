import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt
} from "viem";

import { underwriteInvoice } from "../src/underwriter.js";
import type {
  InvoiceRiskInput,
  ModelDecision,
  UnderwritingModel,
  UnderwritingPolicy
} from "../src/schema.js";

const CHAIN_ID = 1_952;
const FIXTURE_TIMESTAMP = 2_000_000_000;
const BPS = 10_000n;
const UNIT = 10n ** 6n;
const FACE_VALUE = 100n * UNIT;
const REQUESTED_ADVANCE = 75n * UNIT;
const HARD_MAXIMUM = 80n * UNIT;
const MODEL_MAXIMUM = 70n * UNIT;
const REPAYMENT = 73_500_000n;
const LOCAL_FIXTURE = "LOCAL FIXTURE — NO REAL VALUE";
const RECORDED_MODEL = "RECORDED AI FIXTURE — NO LIVE MODEL";
const PUBLIC_ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

const xLayerFixture = defineChain({
  id: CHAIN_ID,
  name: "OpenBell Receivables local X Layer fixture",
  nativeCurrency: { name: "Fixture OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } }
});

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const outputPath = resolve(repoRoot, ".openbell/receivables-fixture-manifest.json");

interface FoundryArtifact {
  abi: Abi;
  bytecode: { object: Hex };
}

interface ReceiptEvidence {
  transactionHash: Hex;
  blockHash: Hex;
  blockNumber: string;
  gasUsed: string;
  status: "success";
  contractAddress?: Address;
  event?: { name: string; args: unknown };
}

const invoiceTypes = {
  InvoiceTerms: [
    { name: "invoiceId", type: "bytes32" },
    { name: "documentHash", type: "bytes32" },
    { name: "supplier", type: "address" },
    { name: "payer", type: "address" },
    { name: "faceValue", type: "uint128" },
    { name: "issuedAt", type: "uint64" },
    { name: "dueDate", type: "uint64" },
    { name: "nonce", type: "uint256" }
  ]
} as const;

const approvalTypes = {
  RiskApproval: [
    { name: "invoiceId", type: "bytes32" },
    { name: "invoiceDigest", type: "bytes32" },
    { name: "funder", type: "address" },
    { name: "advanceAmount", type: "uint128" },
    { name: "repaymentAmount", type: "uint128" },
    { name: "riskTimestamp", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "riskReasonsHash", type: "bytes32" },
    { name: "modelHash", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
} as const;

const rejectionTypes = {
  RiskRejection: [
    { name: "invoiceId", type: "bytes32" },
    { name: "invoiceDigest", type: "bytes32" },
    { name: "riskTimestamp", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "riskReasonsHash", type: "bytes32" },
    { name: "modelHash", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
} as const;

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const asHex = (value: string): Hex => {
  assert(/^0x[0-9a-fA-F]+$/.test(value), "expected hex value");
  return value as Hex;
};

const wait = async (milliseconds: number): Promise<void> =>
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const reserveLoopbackPort = async (): Promise<number> =>
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "failed to reserve a loopback port");
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolvePromise(port)));
    });
  });

const rawRpc = async (rpcUrl: string, method: string): Promise<unknown> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] })
  });
  if (!response.ok) throw new Error(`local RPC HTTP ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "local RPC error");
  return body.result;
};

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), wait(1_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
};

const startLocalAnvil = async (): Promise<{ rpcUrl: string; child: ChildProcess }> => {
  const port = await reserveLoopbackPort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    "anvil",
    [
      "--quiet",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      String(CHAIN_ID),
      "--timestamp",
      String(FIXTURE_TIMESTAMP),
      "--mnemonic",
      PUBLIC_ANVIL_MNEMONIC,
      "--accounts",
      "8"
    ],
    { shell: false, stdio: ["ignore", "ignore", "pipe"] }
  );
  let errorOutput = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    errorOutput = `${errorOutput}${chunk.toString("utf8")}`.slice(-4_096);
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Anvil exited before readiness: ${errorOutput}`);
    try {
      const [version, chainId] = await Promise.all([
        rawRpc(rpcUrl, "web3_clientVersion"),
        rawRpc(rpcUrl, "eth_chainId")
      ]);
      assert(typeof version === "string" && version.toLowerCase().includes("anvil"), "RPC is not Anvil");
      assert(chainId === `0x${CHAIN_ID.toString(16)}`, "Anvil chain ID mismatch");
      return { rpcUrl, child };
    } catch {
      await wait(50);
    }
  }
  await stopChild(child);
  throw new Error(`Anvil did not become ready: ${errorOutput}`);
};

const loadArtifact = async (relativePath: string): Promise<FoundryArtifact> => {
  const value = JSON.parse(await readFile(resolve(repoRoot, relativePath), "utf8")) as Partial<FoundryArtifact>;
  assert(Array.isArray(value.abi), `artifact ABI missing: ${relativePath}`);
  assert(value.bytecode?.object?.startsWith("0x"), `artifact bytecode missing: ${relativePath}`);
  return value as FoundryArtifact;
};

const walletFor = (rpcUrl: string, account: Address) =>
  createWalletClient({ account, chain: xLayerFixture, transport: http(rpcUrl) });

const serialize = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    assert(Number.isSafeInteger(value), "fixture manifest contains an unsafe number");
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serialize(entry)]));
  }
  return value;
};

const receiptEvidence = (
  receipt: TransactionReceipt,
  contractAddress?: Address,
  contractAbi?: Abi,
  expectedEventName?: string
): ReceiptEvidence => {
  assert(receipt.status === "success", `transaction reverted: ${receipt.transactionHash}`);
  let event: ReceiptEvidence["event"];
  if (expectedEventName !== undefined) {
    assert(contractAddress && contractAbi, "event decoding requires contract address and ABI");
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: contractAbi, data: log.data, topics: log.topics, strict: true });
        if (decoded.eventName === expectedEventName) {
          event = { name: decoded.eventName, args: serialize(decoded.args) };
          break;
        }
      } catch {
        // Ignore unrelated logs from the same call; the required event must decode exactly.
      }
    }
    assert(event, `missing expected event ${expectedEventName}`);
  }
  return {
    transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    status: "success",
    ...(receipt.contractAddress ? { contractAddress: getAddress(receipt.contractAddress) } : {}),
    ...(event ? { event } : {})
  };
};

const deploy = async (
  publicClient: PublicClient,
  rpcUrl: string,
  deployer: Address,
  artifact: FoundryArtifact,
  args: readonly unknown[]
): Promise<{ address: Address; receipt: ReceiptEvidence }> => {
  const hash = await walletFor(rpcUrl, deployer).deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert(receipt.contractAddress, "deployment receipt missing contract address");
  return { address: getAddress(receipt.contractAddress), receipt: receiptEvidence(receipt) };
};

const write = async (args: {
  publicClient: PublicClient;
  rpcUrl: string;
  account: Address;
  address: Address;
  artifact: FoundryArtifact;
  functionName: string;
  functionArgs?: readonly unknown[];
  expectedEventName?: string;
}): Promise<ReceiptEvidence> => {
  const hash = await walletFor(args.rpcUrl, args.account).writeContract({
    address: args.address,
    abi: args.artifact.abi,
    functionName: args.functionName,
    args: args.functionArgs ?? []
  } as never);
  return receiptEvidence(
    await args.publicClient.waitForTransactionReceipt({ hash }),
    args.address,
    args.artifact.abi,
    args.expectedEventName
  );
};

class RecordedModel implements UnderwritingModel {
  readonly modelId = "openbell-receivables-recorded-fixture:v1";

  constructor(private readonly response: ModelDecision) {}

  async decide(): Promise<ModelDecision> {
    return this.response;
  }
}

const policy: UnderwritingPolicy = {
  maxAdvanceBps: 8_000,
  maxFeeBps: 2_000,
  maxRiskAgeSeconds: 3_600,
  maxDecisionLifetimeSeconds: 900,
  minConfidenceBps: 7_000,
  maxTenorSeconds: 90 * 24 * 60 * 60
};

const makeInput = (args: {
  invoiceId: Hex;
  invoiceDigest: Hex;
  supplier: Address;
  payer: Address;
  funder: Address;
  defaults: number;
  context: string;
}): InvoiceRiskInput => ({
  invoiceId: args.invoiceId,
  invoiceDigest: args.invoiceDigest,
  supplier: args.supplier,
  payer: args.payer,
  funder: args.funder,
  faceValue: FACE_VALUE.toString(),
  issuedAt: FIXTURE_TIMESTAMP - 60,
  dueDate: FIXTURE_TIMESTAMP + 30 * 24 * 60 * 60,
  requestedAdvance: REQUESTED_ADVANCE.toString(),
  evidence: {
    supplierSignatureValid: true,
    payerSignatureValid: true,
    duplicateInvoiceFound: false,
    documentHashMatches: true
  },
  payerHistory: {
    completedSettlements: args.defaults === 0 ? 12 : 2,
    onTimeSettlements: args.defaults === 0 ? 11 : 1,
    lateSettlements: args.defaults === 0 ? 1 : 0,
    defaults: args.defaults,
    concentrationBps: 2_000,
    daysSinceLastSettlement: 8
  },
  redactedContext: args.context
});

const invoiceStatus = async (
  publicClient: PublicClient,
  address: Address,
  artifact: FoundryArtifact,
  invoiceId: Hex
): Promise<string> => {
  const record = (await publicClient.readContract({
    address,
    abi: artifact.abi,
    functionName: "invoices",
    args: [invoiceId]
  } as never)) as readonly unknown[];
  assert(Array.isArray(record) && record.length === 11, "unexpected invoice record shape");
  return String(record[0]);
};

const tokenBalance = async (
  publicClient: PublicClient,
  address: Address,
  artifact: FoundryArtifact,
  account: Address
): Promise<bigint> =>
  (await publicClient.readContract({
    address,
    abi: artifact.abi,
    functionName: "balanceOf",
    args: [account]
  } as never)) as bigint;

const main = async (): Promise<void> => {
  const { rpcUrl, child } = await startLocalAnvil();
  try {
    const publicClient = createPublicClient({ chain: xLayerFixture, transport: http(rpcUrl) });
    const rawAccounts = await rawRpc(rpcUrl, "eth_accounts");
    assert(Array.isArray(rawAccounts) && rawAccounts.length >= 6, "Anvil did not expose expected accounts");
    const [owner, underwriter, supplier, payer, funder] = rawAccounts.slice(0, 5).map((value) =>
      getAddress(String(value))
    ) as [Address, Address, Address, Address, Address];

    const tokenArtifact = await loadArtifact("out/OpenBellTestUSDG.sol/OpenBellTestUSDG.json");
    const receivablesArtifact = await loadArtifact("out/OpenBellReceivables.sol/OpenBellReceivables.json");
    const token = await deploy(publicClient, rpcUrl, owner, tokenArtifact, []);
    const receivables = await deploy(publicClient, rpcUrl, owner, receivablesArtifact, [
      token.address,
      owner,
      underwriter,
      8_000,
      2_000,
      3_600,
      7 * 24 * 60 * 60,
      90 * 24 * 60 * 60
    ]);

    const domain = {
      name: "OpenBell Receivables",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: receivables.address
    } as const;

    const funderClaim = await write({
      publicClient,
      rpcUrl,
      account: funder,
      address: token.address,
      artifact: tokenArtifact,
      functionName: "claimFixtureTokens",
      expectedEventName: "Transfer"
    });
    const payerClaim = await write({
      publicClient,
      rpcUrl,
      account: payer,
      address: token.address,
      artifact: tokenArtifact,
      functionName: "claimFixtureTokens",
      expectedEventName: "Transfer"
    });

    const registerInvoice = async (label: string, nonce: bigint) => {
      const terms = {
        invoiceId: keccak256(stringToHex(`OPENBELL_RECEIVABLES:${label}:invoice`)),
        documentHash: keccak256(stringToHex(`OPENBELL_RECEIVABLES:${label}:redacted-document`)),
        supplier,
        payer,
        faceValue: FACE_VALUE,
        issuedAt: BigInt(FIXTURE_TIMESTAMP - 60),
        dueDate: BigInt(FIXTURE_TIMESTAMP + 30 * 24 * 60 * 60),
        nonce
      } as const;
      const invoiceDigest = (await publicClient.readContract({
        address: receivables.address,
        abi: receivablesArtifact.abi,
        functionName: "hashInvoice",
        args: [terms]
      } as never)) as Hex;
      const localInvoiceDigest = hashTypedData({
        domain,
        types: invoiceTypes,
        primaryType: "InvoiceTerms",
        message: terms
      });
      assert(localInvoiceDigest === invoiceDigest, "local and contract invoice digests differ");
      const supplierSignature = await walletFor(rpcUrl, supplier).signTypedData({
        domain,
        types: invoiceTypes,
        primaryType: "InvoiceTerms",
        message: terms
      });
      const payerSignature = await walletFor(rpcUrl, payer).signTypedData({
        domain,
        types: invoiceTypes,
        primaryType: "InvoiceTerms",
        message: terms
      });
      const recoveredSupplier = getAddress(
        await recoverTypedDataAddress({
          domain,
          types: invoiceTypes,
          primaryType: "InvoiceTerms",
          message: terms,
          signature: supplierSignature
        })
      );
      const recoveredPayer = getAddress(
        await recoverTypedDataAddress({
          domain,
          types: invoiceTypes,
          primaryType: "InvoiceTerms",
          message: terms,
          signature: payerSignature
        })
      );
      assert(recoveredSupplier === supplier, "supplier invoice signature recovered the wrong signer");
      assert(recoveredPayer === payer, "payer invoice signature recovered the wrong signer");
      const receipt = await write({
        publicClient,
        rpcUrl,
        account: supplier,
        address: receivables.address,
        artifact: receivablesArtifact,
        functionName: "registerInvoice",
        functionArgs: [terms, supplierSignature, payerSignature],
        expectedEventName: "InvoiceRegistered"
      });
      return { terms, invoiceDigest, receipt, recoveredSupplier, recoveredPayer };
    };

    const rejectedBalancesBefore = {
      supplier: await tokenBalance(publicClient, token.address, tokenArtifact, supplier),
      payer: await tokenBalance(publicClient, token.address, tokenArtifact, payer),
      funder: await tokenBalance(publicClient, token.address, tokenArtifact, funder),
      receivables: await tokenBalance(publicClient, token.address, tokenArtifact, receivables.address)
    };
    const rejected = await registerInvoice("rejected", 1n);
    const rejectionModel: ModelDecision = {
      verdict: "REJECT",
      maximumAdvanceBps: 0,
      feeBps: 0,
      confidenceBps: 9_400,
      reasons: ["PRIOR_DEFAULT"],
      explanation: "A recorded prior default is outside the fixture underwriting appetite."
    };
    const rejectionDecision = await underwriteInvoice({
      input: makeInput({
        invoiceId: rejected.terms.invoiceId,
        invoiceDigest: rejected.invoiceDigest,
        supplier,
        payer,
        funder,
        defaults: 1,
        context: "Redacted fixture invoice with a recorded prior payer default."
      }),
      model: new RecordedModel(rejectionModel),
      policy,
      now: FIXTURE_TIMESTAMP
    });
    assert(rejectionDecision.verdict === "REJECT", "recorded rejection model did not reject");
    const rejection = {
      invoiceId: asHex(rejectionDecision.invoiceId),
      invoiceDigest: asHex(rejectionDecision.invoiceDigest),
      riskTimestamp: BigInt(rejectionDecision.riskTimestamp),
      expiresAt: BigInt(rejectionDecision.expiresAt),
      riskReasonsHash: asHex(rejectionDecision.riskReasonsHash),
      modelHash: asHex(rejectionDecision.modelHash),
      nonce: 1n
    } as const;
    const rejectionDigest = (await publicClient.readContract({
      address: receivables.address,
      abi: receivablesArtifact.abi,
      functionName: "hashRejection",
      args: [rejection]
    } as never)) as Hex;
    assert(
      hashTypedData({ domain, types: rejectionTypes, primaryType: "RiskRejection", message: rejection }) ===
        rejectionDigest,
      "local and contract rejection digests differ"
    );
    const rejectionSignature = await walletFor(rpcUrl, underwriter).signTypedData({
      domain,
      types: rejectionTypes,
      primaryType: "RiskRejection",
      message: rejection
    });
    const recoveredRejectionSigner = getAddress(
      await recoverTypedDataAddress({
        domain,
        types: rejectionTypes,
        primaryType: "RiskRejection",
        message: rejection,
        signature: rejectionSignature
      })
    );
    assert(recoveredRejectionSigner === underwriter, "rejection signature recovered the wrong signer");
    const rejectionReceipt = await write({
      publicClient,
      rpcUrl,
      account: supplier,
      address: receivables.address,
      artifact: receivablesArtifact,
      functionName: "attestRejection",
      functionArgs: [rejection, rejectionSignature],
      expectedEventName: "InvoiceRejected"
    });
    assert(
      (await invoiceStatus(publicClient, receivables.address, receivablesArtifact, rejected.terms.invoiceId)) === "5",
      "rejected invoice did not reach REJECTED"
    );
    const rejectedBalancesAfter = {
      supplier: await tokenBalance(publicClient, token.address, tokenArtifact, supplier),
      payer: await tokenBalance(publicClient, token.address, tokenArtifact, payer),
      funder: await tokenBalance(publicClient, token.address, tokenArtifact, funder),
      receivables: await tokenBalance(publicClient, token.address, tokenArtifact, receivables.address)
    };
    const rejectedTokenBalanceDeltas = {
      supplier: rejectedBalancesAfter.supplier - rejectedBalancesBefore.supplier,
      payer: rejectedBalancesAfter.payer - rejectedBalancesBefore.payer,
      funder: rejectedBalancesAfter.funder - rejectedBalancesBefore.funder,
      receivables: rejectedBalancesAfter.receivables - rejectedBalancesBefore.receivables
    };
    assert(
      Object.values(rejectedTokenBalanceDeltas).every((delta) => delta === 0n),
      "rejected journey moved fixture settlement tokens"
    );

    const approved = await registerInvoice("approved", 2n);
    const approvalModel: ModelDecision = {
      verdict: "APPROVE",
      maximumAdvanceBps: 7_000,
      feeBps: 500,
      confidenceBps: 9_100,
      reasons: ["DUAL_SIGNATURES_VERIFIED", "CLEAN_DUPLICATE_CHECK", "STRONG_ON_TIME_HISTORY"],
      explanation: "The recorded model caps the advance at 70% despite the contract allowing 80%."
    };
    const approvalDecision = await underwriteInvoice({
      input: makeInput({
        invoiceId: approved.terms.invoiceId,
        invoiceDigest: approved.invoiceDigest,
        supplier,
        payer,
        funder,
        defaults: 0,
        context: "Redacted fixture invoice with strong recorded settlement history."
      }),
      model: new RecordedModel(approvalModel),
      policy,
      now: FIXTURE_TIMESTAMP
    });
    assert(approvalDecision.verdict === "APPROVE", "recorded approval model did not approve");
    assert((FACE_VALUE * 8_000n) / BPS === HARD_MAXIMUM, "hard maximum arithmetic changed");
    assert((FACE_VALUE * 7_000n) / BPS === MODEL_MAXIMUM, "model maximum arithmetic changed");
    assert(HARD_MAXIMUM > MODEL_MAXIMUM, "AI cap is not tighter than the contract cap");
    assert(REQUESTED_ADVANCE > MODEL_MAXIMUM, "requested advance does not exercise the AI cap");
    assert(BigInt(approvalDecision.advanceAmount) === MODEL_MAXIMUM, "bounded AI advance differs");
    assert(BigInt(approvalDecision.repaymentAmount) === REPAYMENT, "bounded repayment differs");

    const approval = {
      invoiceId: asHex(approvalDecision.invoiceId),
      invoiceDigest: asHex(approvalDecision.invoiceDigest),
      funder: getAddress(approvalDecision.funder),
      advanceAmount: BigInt(approvalDecision.advanceAmount),
      repaymentAmount: BigInt(approvalDecision.repaymentAmount),
      riskTimestamp: BigInt(approvalDecision.riskTimestamp),
      expiresAt: BigInt(approvalDecision.expiresAt),
      riskReasonsHash: asHex(approvalDecision.riskReasonsHash),
      modelHash: asHex(approvalDecision.modelHash),
      nonce: 2n
    } as const;
    const approvalDigest = (await publicClient.readContract({
      address: receivables.address,
      abi: receivablesArtifact.abi,
      functionName: "hashApproval",
      args: [approval]
    } as never)) as Hex;
    assert(
      hashTypedData({ domain, types: approvalTypes, primaryType: "RiskApproval", message: approval }) ===
        approvalDigest,
      "local and contract approval digests differ"
    );
    const approvalSignature = await walletFor(rpcUrl, underwriter).signTypedData({
      domain,
      types: approvalTypes,
      primaryType: "RiskApproval",
      message: approval
    });
    const recoveredApprovalSigner = getAddress(
      await recoverTypedDataAddress({
        domain,
        types: approvalTypes,
        primaryType: "RiskApproval",
        message: approval,
        signature: approvalSignature
      })
    );
    assert(recoveredApprovalSigner === underwriter, "approval signature recovered the wrong signer");

    const funderApproval = await write({
      publicClient,
      rpcUrl,
      account: funder,
      address: token.address,
      artifact: tokenArtifact,
      functionName: "approve",
      functionArgs: [receivables.address, approval.advanceAmount],
      expectedEventName: "Approval"
    });
    const supplierBefore = (await publicClient.readContract({
      address: token.address,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [supplier]
    } as never)) as bigint;
    const funderBefore = (await publicClient.readContract({
      address: token.address,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [funder]
    } as never)) as bigint;
    const fundReceipt = await write({
      publicClient,
      rpcUrl,
      account: funder,
      address: receivables.address,
      artifact: receivablesArtifact,
      functionName: "fund",
      functionArgs: [approval, approvalSignature],
      expectedEventName: "InvoiceFunded"
    });
    const supplierAfter = (await publicClient.readContract({
      address: token.address,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [supplier]
    } as never)) as bigint;
    const funderAfterFund = (await publicClient.readContract({
      address: token.address,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [funder]
    } as never)) as bigint;
    assert(supplierAfter - supplierBefore === MODEL_MAXIMUM, "supplier did not receive exact advance");
    assert(funderBefore - funderAfterFund === MODEL_MAXIMUM, "funder did not send exact advance");

    const payerApproval = await write({
      publicClient,
      rpcUrl,
      account: payer,
      address: token.address,
      artifact: tokenArtifact,
      functionName: "approve",
      functionArgs: [receivables.address, approval.repaymentAmount],
      expectedEventName: "Approval"
    });
    const payerBefore = (await publicClient.readContract({
      address: token.address,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [payer]
    } as never)) as bigint;
    const settleReceipt = await write({
      publicClient,
      rpcUrl,
      account: payer,
      address: receivables.address,
      artifact: receivablesArtifact,
      functionName: "settle",
      functionArgs: [approved.terms.invoiceId],
      expectedEventName: "InvoiceSettled"
    });
    const payerAfter = (await publicClient.readContract({
      address: token.address,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [payer]
    } as never)) as bigint;
    const funderAfterSettle = (await publicClient.readContract({
      address: token.address,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [funder]
    } as never)) as bigint;
    assert(payerBefore - payerAfter === REPAYMENT, "payer did not settle exact repayment");
    assert(funderAfterSettle - funderAfterFund === REPAYMENT, "funder did not receive exact repayment");
    assert(
      (await invoiceStatus(publicClient, receivables.address, receivablesArtifact, approved.terms.invoiceId)) === "3",
      "approved invoice did not reach SETTLED"
    );

    const manifest = {
      schemaVersion: "openbell-receivables-local-fixture-v1",
      disclosures: {
        localFixture: LOCAL_FIXTURE,
        recordedModel: RECORDED_MODEL,
        networkTransaction: false,
        realValue: false,
        liveModel: false,
        independentlyVerified: false
      },
      chain: { chainId: String(CHAIN_ID), client: "self-spawned Anvil", explorerReceipts: false },
      actors: { owner, underwriter, supplier, payer, funder },
      assertions: {
        typedDataDigestParityChecked: true,
        expectedSignersRecovered: true,
        rejectedPathZeroTokenMovement: true
      },
      contracts: {
        fixtureSettlementToken: token.address,
        receivables: receivables.address,
        deploymentReceipts: { token: token.receipt, receivables: receivables.receipt }
      },
      fixtureFunding: { funderClaim, payerClaim },
      rejectedJourney: {
        invoiceId: rejected.terms.invoiceId,
        invoiceDigest: rejected.invoiceDigest,
        requestedAdvance: REQUESTED_ADVANCE.toString(),
        modelDecision: rejectionModel,
        riskReasonsHash: rejectionDecision.riskReasonsHash,
        modelHash: rejectionDecision.modelHash,
        rejectionDigest,
        decisionNonce: "1",
        finalStatus: "REJECTED",
        recoveredSigners: {
          supplier: rejected.recoveredSupplier,
          payer: rejected.recoveredPayer,
          underwriter: recoveredRejectionSigner
        },
        exactTokenBalanceDeltas: rejectedTokenBalanceDeltas,
        receipts: { register: rejected.receipt, reject: rejectionReceipt }
      },
      approvedJourney: {
        invoiceId: approved.terms.invoiceId,
        invoiceDigest: approved.invoiceDigest,
        faceValue: FACE_VALUE.toString(),
        requestedAdvance: REQUESTED_ADVANCE.toString(),
        contractMaximum: HARD_MAXIMUM.toString(),
        recordedModelMaximum: MODEL_MAXIMUM.toString(),
        fundedAdvance: approval.advanceAmount.toString(),
        repayment: approval.repaymentAmount.toString(),
        modelDecision: approvalModel,
        riskReasonsHash: approvalDecision.riskReasonsHash,
        modelHash: approvalDecision.modelHash,
        approvalDigest,
        decisionNonce: "2",
        finalStatus: "SETTLED",
        recoveredSigners: {
          supplier: approved.recoveredSupplier,
          payer: approved.recoveredPayer,
          underwriter: recoveredApprovalSigner
        },
        exactBalanceDeltas: {
          supplierAtFund: (supplierAfter - supplierBefore).toString(),
          funderAtFund: (funderAfterFund - funderBefore).toString(),
          payerAtSettlement: (payerAfter - payerBefore).toString(),
          funderAtSettlement: (funderAfterSettle - funderAfterFund).toString()
        },
        receipts: {
          register: approved.receipt,
          funderApproval,
          fund: fundReceipt,
          payerApproval,
          settle: settleReceipt
        }
      }
    };

    await mkdir(resolve(repoRoot, ".openbell"), { recursive: true });
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(serialize(manifest), null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, outputPath);
    process.stdout.write(
      [
        LOCAL_FIXTURE,
        RECORDED_MODEL,
        "AI rejection: prior default -> REJECTED",
        "AI-bounded approval: requested 75 -> contract max 80 -> model max 70",
        "Exact lifecycle: 70 fixture USDG funded -> 73.5 settled -> SETTLED",
        `Manifest: ${outputPath}`
      ].join("\n") + "\n"
    );
  } finally {
    await stopChild(child);
  }
};

await main();
