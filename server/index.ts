import { TwoProviderConnectedInvoiceObserver, type ReadOnlyJsonRpc } from "../agent/src/confirmed-connected-observer.js";
import {
  CONNECTED_MAINNET,
  CONNECTED_TESTNET,
  ConnectedUnderwritingService,
  connectedUnderwritingRequestSchema,
  mainnetUnderwritingRequestSchema,
  type ConnectedDeployment
} from "../agent/src/connected-underwriting.js";
import { D1ConnectedDecisionStore, type D1DatabaseLike } from "../agent/src/d1-connected-decision-store.js";
import { StrictBankrUnderwritingModel } from "../agent/src/live-model.js";

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
    (deployment === CONNECTED_TESTNET ? connectedUnderwritingRequestSchema : mainnetUnderwritingRequestSchema).parse(body);
    const model = new StrictBankrUnderwritingModel({
      apiKey: config.BANKR_API_KEY,
      evidenceBoundary: deployment === CONNECTED_MAINNET ? "registered-mainnet" : "synthetic"
    });
    const providerDefinitions = deployment === CONNECTED_TESTNET ? officialTestnetProviders : officialMainnetProviders;
    const observer = new TwoProviderConnectedInvoiceObserver(providerDefinitions.map(
      ({ label, endpoint }) => new OfficialReadOnlyRpc(label, endpoint)
    ) as unknown as readonly [OfficialReadOnlyRpc, OfficialReadOnlyRpc], deployment);
    const service = new ConnectedUnderwritingService({
      observer,
      store: new D1ConnectedDecisionStore(config.DB),
      modelFactory: () => model,
      deployment
    });
    return json(await service.authorize(body));
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "CONNECTED_UNDERWRITING_FAILED";
    const status = code.includes("IN_PROGRESS") ? 409 : code.includes("BUDGET") ? 429 : 422;
    return json({ error: code }, status);
  }
};

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/connected-underwriting") return underwritingResponse(request, environment, CONNECTED_TESTNET);
    if (url.pathname === "/api/mainnet-underwriting") return underwritingResponse(request, environment, CONNECTED_MAINNET);
    if (url.pathname === "/") url.pathname = "/index.html";
    else if (url.pathname.endsWith("/")) url.pathname += "index.html";
    else if (!url.pathname.split("/").at(-1)?.includes(".")) url.pathname += "/index.html";
    return environment.ASSETS.fetch(new Request(url, request));
  }
};
