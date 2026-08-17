import { TwoProviderConnectedInvoiceObserver, type ReadOnlyJsonRpc } from "../agent/src/confirmed-connected-observer.js";
import {
  CONNECTED_MAINNET,
  CONNECTED_TESTNET,
  ConnectedPolicyRefusal,
  ConnectedUnderwritingService,
  connectedArtifactHashOf,
  connectedRequestHashOf,
  connectedUnderwritingRequestSchema,
  mainnetUnderwritingRequestSchema,
  receiptBoundMainnetUnderwritingRequestSchema,
  RECEIPT_BOUND_MAINNET_SCHEMA,
  type ConnectedDeployment
} from "../agent/src/connected-underwriting.js";
import { MAINNET_RECEIPT_HISTORY_BASELINE } from "../agent/src/mainnet-receipt-history-baseline.js";
import { parseReceiptBoundHistorySnapshot } from "../agent/src/receipt-bound-history.js";
import { D1ConnectedDecisionStore, type D1DatabaseLike } from "../agent/src/d1-connected-decision-store.js";
import { StrictBankrUnderwritingModel } from "../agent/src/live-model.js";
import { assertFundingCandidateAgainstInvoice, validateFundingCandidate } from "../web/funding-candidate.mjs";
import { buildInvoiceStateCall, decodeInvoiceState } from "../web/testnet-flow.mjs";

interface AssetBinding { fetch(request: Request): Promise<Response> }
interface Environment {
  readonly ASSETS: AssetBinding;
  readonly DB: D1DatabaseLike;
  readonly BANKR_API_KEY: string;
}

const officialTestnetProviders = [
  { label: "official-xlayer-testnet", endpoint: "https://testrpc.xlayer.tech/terigon" },
  { label: "official-okx-testnet", endpoint: "https://xlayertestrpc.okx.com/terigon" }
] as const;
const officialMainnetProviders = [
  { label: "official-xlayer-mainnet", endpoint: "https://rpc.xlayer.tech" },
  { label: "official-okx-mainnet", endpoint: "https://xlayerrpc.okx.com" }
] as const;
const MAX_REQUEST_BYTES = 16 * 1_024;
const RPC_TIMEOUT_MS = 12_000;
const RPC_MAX_RESPONSE_BYTES = 512 * 1_024;
const RECEIPT_HISTORY_MAX_AGE_SECONDS = 48 * 60 * 60;
const decisionStores = new WeakMap<D1DatabaseLike, D1ConnectedDecisionStore>();
const decisionStoreFor = (database: D1DatabaseLike): D1ConnectedDecisionStore => {
  const existing = decisionStores.get(database);
  if (existing) return existing;
  const created = new D1ConnectedDecisionStore(database);
  decisionStores.set(database, created);
  return created;
};

const boundedText = async (response: Response, maximum: number, errorCode: string): Promise<string> => {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximum) throw new Error(errorCode);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error(errorCode);
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(output);
};

class OfficialReadOnlyRpc implements ReadOnlyJsonRpc {
  #id = 0;
  constructor(readonly label: string, readonly endpoint: string) {}
  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!/^eth_(?:chainId|blockNumber|getTransactionByHash|getTransactionReceipt|getBlockByNumber|call)$/.test(method)) {
      throw new Error("CONNECTED_RPC_METHOD_NOT_ALLOWED");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.#id, method, params }),
        signal: controller.signal
      });
      const raw = await boundedText(response, RPC_MAX_RESPONSE_BYTES, "CONNECTED_RPC_RESPONSE_TOO_LARGE");
      if (!response.ok) throw new Error("CONNECTED_RPC_HTTP_FAILURE");
      const envelope: unknown = JSON.parse(raw);
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("CONNECTED_RPC_INVALID_ENVELOPE");
      const record = envelope as Record<string, unknown>;
      if (record.error !== undefined || !("result" in record)) throw new Error("CONNECTED_RPC_RETURNED_ERROR");
      return record.result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("CONNECTED_RPC_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

const underwritingResponse = async (request: Request, config: Environment, deployment: ConnectedDeployment): Promise<Response> => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin") {
    return json({ error: "SAME_ORIGIN_REQUIRED" }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON_CONTENT_TYPE_REQUIRED" }, 415);
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_REQUEST_BYTES) return json({ error: "REQUEST_TOO_LARGE" }, 413);
  let body: unknown;
  try {
    const raw = await boundedText(new Response(request.body), MAX_REQUEST_BYTES, "REQUEST_TOO_LARGE");
    body = JSON.parse(raw);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "INVALID_REQUEST" }, 400);
  }
  try {
    const requestSchema = deployment === CONNECTED_TESTNET ? connectedUnderwritingRequestSchema
      : (body as { schemaVersion?: unknown })?.schemaVersion === RECEIPT_BOUND_MAINNET_SCHEMA ? receiptBoundMainnetUnderwritingRequestSchema : mainnetUnderwritingRequestSchema;
    requestSchema.parse(body);
    const historyVerifier = deployment === CONNECTED_MAINNET ? {
      verify: async (candidate: { receiptBoundHistory?: unknown }) => {
        const supplied = parseReceiptBoundHistorySnapshot(candidate.receiptBoundHistory);
        if (JSON.stringify(supplied) !== JSON.stringify(MAINNET_RECEIPT_HISTORY_BASELINE)) throw new Error("CONNECTED_RECEIPT_HISTORY_BASELINE_MISMATCH");
        await verifyReceiptHistoryBaseline();
      }
    } : undefined;
    const model = new StrictBankrUnderwritingModel({
      apiKey: config.BANKR_API_KEY,
      evidenceBoundary: (body as { schemaVersion?: unknown })?.schemaVersion === RECEIPT_BOUND_MAINNET_SCHEMA
        ? "receipt-bound-mainnet" : deployment === CONNECTED_MAINNET ? "registered-mainnet" : "synthetic"
    });
    const providerDefinitions = deployment === CONNECTED_TESTNET ? officialTestnetProviders : officialMainnetProviders;
    const observer = new TwoProviderConnectedInvoiceObserver(providerDefinitions.map(
      ({ label, endpoint }) => new OfficialReadOnlyRpc(label, endpoint)
    ) as unknown as readonly [OfficialReadOnlyRpc, OfficialReadOnlyRpc], deployment);
    const service = new ConnectedUnderwritingService({
      observer,
      store: decisionStoreFor(config.DB),
      modelFactory: () => model,
      deployment,
      ...(historyVerifier ? { historyVerifier } : {})
    });
    const assessment = await service.authorize(body);
    return json({ ...assessment, artifactHash: connectedArtifactHashOf(assessment) });
  } catch (error) {
    if (error instanceof ConnectedPolicyRefusal) {
      return json({ error: error.message, policyRefusal: error.evidence, policyRefusalArtifactHash: error.artifactHash }, 422);
    }
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "CONNECTED_UNDERWRITING_FAILED";
    const status = code.includes("IN_PROGRESS") ? 409 : code.includes("BUDGET") ? 429 : 422;
    return json({ error: code }, status);
  }
};

const verifyReceiptHistoryBaseline = async (): Promise<void> => {
  const providers = officialMainnetProviders.map(({ label, endpoint }) => new OfficialReadOnlyRpc(label, endpoint));
  const [chainIds, heads, pinnedBlocks] = await Promise.all([
    Promise.all(providers.map((rpc) => rpc.request("eth_chainId", []))),
    Promise.all(providers.map((rpc) => rpc.request("eth_getBlockByNumber", ["latest", false]))),
    Promise.all(providers.map((rpc) => rpc.request("eth_getBlockByNumber", [`0x${BigInt(MAINNET_RECEIPT_HISTORY_BASELINE.throughBlock).toString(16)}`, false])))
  ]);
  if (chainIds.some((value) => value !== "0xc4")) throw new Error("CONNECTED_RECEIPT_HISTORY_WRONG_CHAIN");
  const headRecords = heads as Array<{ number?: unknown; timestamp?: unknown }>;
  const pinnedRecords = pinnedBlocks as Array<{ hash?: unknown; number?: unknown; timestamp?: unknown }>;
  if (pinnedRecords.some((block) => String(block.hash).toLowerCase() !== MAINNET_RECEIPT_HISTORY_BASELINE.throughBlockHash
    || BigInt(String(block.number)) !== BigInt(MAINNET_RECEIPT_HISTORY_BASELINE.throughBlock))) throw new Error("CONNECTED_RECEIPT_HISTORY_REORG");
  const headNumbers = headRecords.map((block) => BigInt(String(block.number)));
  const headTimes = headRecords.map((block) => Number(BigInt(String(block.timestamp))));
  const pinnedTimes = pinnedRecords.map((block) => Number(BigInt(String(block.timestamp))));
  if (headNumbers.some((number) => number < BigInt(MAINNET_RECEIPT_HISTORY_BASELINE.throughBlock) + 12n)) throw new Error("CONNECTED_RECEIPT_HISTORY_NOT_CONFIRMED");
  if (Math.max(...headTimes) - Math.min(...pinnedTimes) > RECEIPT_HISTORY_MAX_AGE_SECONDS) throw new Error("CONNECTED_RECEIPT_HISTORY_STALE");
  if (Math.max(...headTimes) - Math.min(...headTimes) > 120 || Math.max(...pinnedTimes) !== Math.min(...pinnedTimes)) throw new Error("CONNECTED_RECEIPT_HISTORY_PROVIDER_DISAGREEMENT");
};

const receiptHistoryResponse = async (request: Request): Promise<Response> => {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const payer = new URL(request.url).searchParams.get("payer");
  if (payer?.toLowerCase() !== MAINNET_RECEIPT_HISTORY_BASELINE.payer.toLowerCase()) return json({ error: "RECEIPT_HISTORY_NOT_AVAILABLE" }, 404);
  try {
    await verifyReceiptHistoryBaseline();
    return json({ snapshot: MAINNET_RECEIPT_HISTORY_BASELINE, source: "two-official-rpc-confirmed-checkpoint", defaultsRepresented: false });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "CONNECTED_RECEIPT_HISTORY_UNAVAILABLE";
    return json({ error: code }, 503);
  }
};

const artifactStatusResponse = async (request: Request, config: Environment): Promise<Response> => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin") return json({ error: "SAME_ORIGIN_REQUIRED" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON_CONTENT_TYPE_REQUIRED" }, 415);
  let body: unknown;
  try {
    const raw = await boundedText(new Response(request.body), 2_048, "REQUEST_TOO_LARGE");
    body = JSON.parse(raw);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "INVALID_REQUEST" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "INVALID_ARTIFACT_QUERY" }, 400);
  const candidate = body as Record<string, unknown>;
  const keys = Object.keys(candidate).sort().join(",");
  if (keys !== "artifactHash,invoiceId,requestHash"
    || !/^0x[0-9a-f]{64}$/.test(String(candidate.invoiceId))
    || !/^0x[0-9a-f]{64}$/.test(String(candidate.requestHash))
    || !/^0x[0-9a-f]{64}$/.test(String(candidate.artifactHash))) {
    return json({ error: "INVALID_ARTIFACT_QUERY" }, 400);
  }
  const row = await config.DB.prepare(
    `SELECT decision.request_json AS request_json
     FROM connected_underwriting_completed_artifacts AS artifact
     INNER JOIN connected_underwriting_decisions AS decision
       ON decision.invoice_id = artifact.invoice_id AND decision.request_hash = artifact.request_hash
     WHERE artifact.invoice_id = ? AND artifact.request_hash = ? AND artifact.artifact_hash = ?`
  ).bind(candidate.invoiceId, candidate.requestHash, candidate.artifactHash).first<{ request_json: string }>();
  if (!row) return json({ verified: false });
  let storedRequest: unknown;
  try {
    storedRequest = JSON.parse(row.request_json);
  } catch {
    return json({ error: "CORRUPT_ARTIFACT_REQUEST" }, 500);
  }
  const requestRecord = storedRequest as Record<string, unknown>;
  const schema = requestRecord?.schemaVersion === RECEIPT_BOUND_MAINNET_SCHEMA ? receiptBoundMainnetUnderwritingRequestSchema
    : requestRecord?.schemaVersion === CONNECTED_MAINNET.schemaVersion ? mainnetUnderwritingRequestSchema : connectedUnderwritingRequestSchema;
  const parsed = schema.safeParse(storedRequest);
  if (!parsed.success) return json({ error: "CORRUPT_ARTIFACT_REQUEST" }, 500);
  if (parsed.data.invoiceId !== candidate.invoiceId || connectedRequestHashOf(parsed.data) !== candidate.requestHash) {
    return json({ error: "CORRUPT_ARTIFACT_REQUEST" }, 500);
  }
  return json({ verified: true, requestedAdvance: parsed.data.requestedAdvance });
};

const fundingCandidateResponse = async (request: Request, config: Environment): Promise<Response> => {
  if (request.method === "GET") {
    const row = await config.DB.prepare(
      `SELECT candidate_json, expires_at
       FROM mainnet_funding_candidates
       WHERE status = 'OPEN' AND expires_at > unixepoch()
       ORDER BY created_at DESC
       LIMIT 1`
    ).first<{ candidate_json: string; expires_at: number }>();
    if (!row) return json({ error: "NO_OPEN_FUNDING_CANDIDATE" }, 404);
    try {
      const candidate: unknown = JSON.parse(row.candidate_json);
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("INVALID_FUNDING_CANDIDATE");
      const record = candidate as Record<string, unknown>;
      if (record.schemaVersion !== "openbell-mainnet-funding-candidate-v1" || record.status !== "OPEN") throw new Error("INVALID_FUNDING_CANDIDATE");
      const candidateInvoice = record.invoice;
      if (!candidateInvoice || typeof candidateInvoice !== "object" || Array.isArray(candidateInvoice)) throw new Error("INVALID_FUNDING_CANDIDATE");
      const invoiceId = (candidateInvoice as Record<string, unknown>).invoiceId;
      if (typeof invoiceId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(invoiceId)) throw new Error("INVALID_FUNDING_CANDIDATE");
      const call = { to: CONNECTED_MAINNET.receivables, data: buildInvoiceStateCall(invoiceId) };
      const states = await Promise.all(officialMainnetProviders.map(({ label, endpoint }) =>
        new OfficialReadOnlyRpc(label, endpoint).request("eth_call", [call, "latest"])
      ));
      if (typeof states[0] !== "string" || typeof states[1] !== "string" || states[0].toLowerCase() !== states[1].toLowerCase()) {
        return json({ error: "FUNDING_CANDIDATE_STATE_UNAVAILABLE" }, 503);
      }
      if (decodeInvoiceState(states[0] as `0x${string}`).status !== 1) {
        return json({ error: "NO_OPEN_FUNDING_CANDIDATE" }, 404);
      }
      if (!Number.isSafeInteger(row.expires_at) || row.expires_at <= Math.floor(Date.now() / 1_000)) {
        return json({ error: "NO_OPEN_FUNDING_CANDIDATE" }, 404);
      }
      return json(candidate);
    } catch (error) {
      if (error instanceof Error && /^(?:CONNECTED_RPC_|FUNDING_CANDIDATE_PROVIDER_)/.test(error.message)) {
        return json({ error: "FUNDING_CANDIDATE_STATE_UNAVAILABLE" }, 503);
      }
      return json({ error: "CORRUPT_FUNDING_CANDIDATE" }, 500);
    }
  }
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin") {
    return json({ error: "SAME_ORIGIN_REQUIRED" }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON_CONTENT_TYPE_REQUIRED" }, 415);
  try {
    const raw = await boundedText(new Response(request.body), 32 * 1_024, "REQUEST_TOO_LARGE");
    const candidate: unknown = JSON.parse(raw);
    const validated = await validateFundingCandidate(candidate);
    const call = { to: CONNECTED_MAINNET.receivables, data: buildInvoiceStateCall(validated.invoice.invoiceId) };
    const states = await Promise.all(officialMainnetProviders.map(({ label, endpoint }) =>
      new OfficialReadOnlyRpc(label, endpoint).request("eth_call", [call, "latest"])
    ));
    if (typeof states[0] !== "string" || typeof states[1] !== "string" || states[0].toLowerCase() !== states[1].toLowerCase()) {
      throw new Error("FUNDING_CANDIDATE_PROVIDER_DISAGREEMENT");
    }
    const invoice = decodeInvoiceState(states[0] as `0x${string}`);
    assertFundingCandidateAgainstInvoice(validated, invoice);
    if (invoice.status !== 1) throw new Error("FUNDING_CANDIDATE_NOT_REGISTERED");
    const now = Math.floor(Date.now() / 1_000);
    const results = await config.DB.batch([
      config.DB.prepare("UPDATE mainnet_funding_candidates SET status = 'CLOSED', updated_at = ? WHERE status = 'OPEN'").bind(now),
      config.DB.prepare(
        `INSERT INTO mainnet_funding_candidates (invoice_id, candidate_json, status, expires_at, created_at, updated_at)
         VALUES (?, ?, 'OPEN', ?, ?, ?)
         ON CONFLICT(invoice_id) DO UPDATE SET candidate_json = excluded.candidate_json, status = 'OPEN', expires_at = excluded.expires_at, updated_at = excluded.updated_at`
      ).bind(validated.invoice.invoiceId, raw, Number(validated.authority.expiresAt), now, now)
    ]);
    if (results.length !== 2 || results.some((result) => result.success === false)) throw new Error("FUNDING_CANDIDATE_STORE_FAILED");
    return json({ published: true, invoiceId: validated.invoice.invoiceId, expiresAt: validated.authority.expiresAt.toString() }, 201);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "INVALID_FUNDING_CANDIDATE";
    return json({ error: code }, code === "REQUEST_TOO_LARGE" ? 413 : 422);
  }
};

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/connected-underwriting") return underwritingResponse(request, environment, CONNECTED_TESTNET);
    if (url.pathname === "/api/mainnet-underwriting") return underwritingResponse(request, environment, CONNECTED_MAINNET);
    if (url.pathname === "/api/mainnet-receipt-history") return receiptHistoryResponse(request);
    if (url.pathname === "/api/assessment-artifact-status") return artifactStatusResponse(request, environment);
    if (url.pathname === "/api/funding-candidate") return fundingCandidateResponse(request, environment);
    if (url.pathname === "/") url.pathname = "/index.html";
    else if (url.pathname.endsWith("/")) url.pathname += "index.html";
    else if (!url.pathname.split("/").at(-1)?.includes(".")) url.pathname += "/index.html";
    return environment.ASSETS.fetch(new Request(url, request));
  }
};
