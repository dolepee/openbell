import { deriveReceiptBoundHistory } from "../src/receipt-bound-history.js";
import type { ReadOnlyJsonRpc } from "../src/confirmed-connected-observer.js";

const endpoints = [
  { label: "official-xlayer-mainnet", endpoint: "https://rpc.xlayer.tech" },
  { label: "official-okx-mainnet", endpoint: "https://xlayerrpc.okx.com" }
] as const;
const allowedMethods = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getLogs", "eth_call"]);
const maximumResponseBytes = 512 * 1_024;
const requestTimeoutMs = 20_000;
const minimumSpacingMs = 100;
const maximumAttempts = 5;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const boundedText = async (response: Response): Promise<string> => {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximumResponseBytes) throw new Error("RECEIPT_HISTORY_RPC_RESPONSE_TOO_LARGE");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumResponseBytes) {
      await reader.cancel();
      throw new Error("RECEIPT_HISTORY_RPC_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(output);
};

class PacedOfficialRpc implements ReadOnlyJsonRpc {
  #id = 0;
  #lastRequestAt = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(readonly label: string, readonly endpoint: string) {}

  request(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!allowedMethods.has(method)) return Promise.reject(new Error("RECEIPT_HISTORY_RPC_METHOD_NOT_ALLOWED"));
    const operation = this.#tail.then(() => this.#perform(method, params));
    this.#tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #perform(method: string, params: readonly unknown[]): Promise<unknown> {
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const wait = minimumSpacingMs - (Date.now() - this.#lastRequestAt);
      if (wait > 0) await delay(wait);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        this.#lastRequestAt = Date.now();
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.#id, method, params }),
          signal: controller.signal
        });
        const raw = await boundedText(response);
        if ((response.status === 429 || response.status >= 500) && attempt < maximumAttempts) {
          await delay(250 * 2 ** (attempt - 1));
          continue;
        }
        if (!response.ok) throw new Error(`RECEIPT_HISTORY_RPC_HTTP_${response.status}`);
        const envelope: unknown = JSON.parse(raw);
        if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("RECEIPT_HISTORY_RPC_INVALID_ENVELOPE");
        const record = envelope as Record<string, unknown>;
        if (record.error !== undefined || !("result" in record)) throw new Error("RECEIPT_HISTORY_RPC_RETURNED_ERROR");
        return record.result;
      } catch (error) {
        if (controller.signal.aborted) {
          if (attempt < maximumAttempts) {
            await delay(250 * 2 ** (attempt - 1));
            continue;
          }
          throw new Error("RECEIPT_HISTORY_RPC_TIMEOUT");
        }
        if (error instanceof TypeError && attempt < maximumAttempts) {
          await delay(250 * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("RECEIPT_HISTORY_RPC_ATTEMPTS_EXHAUSTED");
  }
}

const payer = process.argv[2];
if (!payer) throw new Error("Usage: tsx agent/scripts/derive-mainnet-receipt-history.ts <payer-address>");

const providers = endpoints.map(({ label, endpoint }) => new PacedOfficialRpc(label, endpoint)) as unknown as readonly [ReadOnlyJsonRpc, ReadOnlyJsonRpc];
const reported = new Map<string, number>();
const snapshot = await deriveReceiptBoundHistory(providers, payer, {
  onChunk: ({ provider, completed, total }) => {
    if (completed === 1 || completed === total || completed % 250 === 0) {
      const previous = reported.get(provider);
      if (previous !== completed) {
        reported.set(provider, completed);
        process.stderr.write(`${provider}: ${completed}/${total} chunks\n`);
      }
    }
  }
});
process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
