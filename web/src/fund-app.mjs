import { formatUnits } from "viem";
import { assertFundingCandidateAgainstInvoice, validateFundingCandidate } from "../funding-candidate.mjs";
import {
  OPENBELL_MAINNET_CONNECTED,
  assertActionAgainstInvoice,
  assertWalletContext,
  buildAllowanceStateCall,
  buildInvoiceStateCall,
  decodeAllowanceState,
  decodeInvoiceState
} from "../testnet-flow.mjs";

const provider = globalThis.ethereum;
const connectButton = document.querySelector("#connect-wallet");
const approveButton = document.querySelector("#approve-funding");
const fundButton = document.querySelector("#fund-invoice");
const consent = document.querySelector("#fund-consent");
const errorNode = document.querySelector("#fund-error");
const completePanel = document.querySelector("#fund-complete");
const PUBLIC_RPC_URL = "https://rpc.xlayer.tech";
const RPC_TIMEOUT_MS = 10_000;

let account;
let chainId;
let candidate;
let invoiceRecord;
let allowance = 0n;
let balance = 0n;
let pendingHash;

const setText = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
};
const compact = (value) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const usd = (value) => `${formatUnits(value, 6)} USDG`;
const rpc = (method, params = []) => {
  if (!provider?.request) throw new Error("No compatible browser wallet was found.");
  return provider.request({ method, params });
};
const publicRpc = async (method, params = []) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(PUBLIC_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`X Layer RPC returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || "X Layer rejected the action simulation.");
    return payload.result;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("X Layer preflight timed out. Retry the action.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
const setError = (message = "") => { errorNode.textContent = message; };
const setBusy = (button, busy, busyText, idleText) => {
  button.setAttribute("aria-busy", String(busy));
  button.textContent = busy ? busyText : idleText;
};

const switchToMainnet = async () => {
  try {
    await rpc("wallet_switchEthereumChain", [{ chainId: OPENBELL_MAINNET_CONNECTED.chainHex }]);
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await rpc("wallet_addEthereumChain", [{
      chainId: OPENBELL_MAINNET_CONNECTED.chainHex,
      chainName: "X Layer Mainnet",
      nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
      rpcUrls: ["https://rpc.xlayer.tech"],
      blockExplorerUrls: ["https://www.okx.com/web3/explorer/xlayer"]
    }]);
  }
  await refreshWallet();
};

const refreshWallet = async ({ requestAccounts = false } = {}) => {
  if (!provider) return render();
  account = (await rpc(requestAccounts ? "eth_requestAccounts" : "eth_accounts"))[0];
  chainId = Number.parseInt(await rpc("eth_chainId"), 16);
  await refreshState();
};

const refreshState = async () => {
  if (!candidate || !account || chainId !== OPENBELL_MAINNET_CONNECTED.chainId) return render();
  const [invoiceResult, allowanceResult, balanceResult] = await Promise.all([
    publicRpc("eth_call", [{ to: OPENBELL_MAINNET_CONNECTED.receivables, data: buildInvoiceStateCall(candidate.invoice.invoiceId) }, "latest"]),
    publicRpc("eth_call", [{ to: OPENBELL_MAINNET_CONNECTED.settlementToken, data: buildAllowanceStateCall(candidate.invoice.funder) }, "latest"]),
    publicRpc("eth_call", [{ to: OPENBELL_MAINNET_CONNECTED.settlementToken, data: `0x70a08231000000000000000000000000${candidate.invoice.funder.slice(2).toLowerCase()}` }, "latest"])
  ]);
  invoiceRecord = decodeInvoiceState(invoiceResult);
  assertFundingCandidateAgainstInvoice(candidate, invoiceRecord);
  allowance = decodeAllowanceState(allowanceResult);
  balance = BigInt(balanceResult);
  setText("#wallet-balance", usd(balance));
  setText("#wallet-allowance", usd(allowance));
  render();
};

const render = () => {
  const connected = Boolean(account);
  connectButton.textContent = connected ? compact(account) : "Connect wallet";
  connectButton.setAttribute("aria-pressed", String(connected));
  setText("#wallet-state", !provider ? "Install an EIP-1193 wallet to fund this invoice."
    : !connected ? "No wallet connected."
      : chainId !== OPENBELL_MAINNET_CONNECTED.chainId ? `Connected on chain ${chainId}. Switch to X Layer mainnet.`
        : account.toLowerCase() !== candidate?.invoice.funder.toLowerCase() ? "This is not the invited funder wallet."
          : invoiceRecord?.status === 2 ? "This invoice is already funded."
            : "Wallet and X Layer state verified.");

  const correctWallet = connected && candidate && chainId === OPENBELL_MAINNET_CONNECTED.chainId
    && account.toLowerCase() === candidate.invoice.funder.toLowerCase();
  const registered = invoiceRecord?.status === 1;
  const funded = invoiceRecord?.status === 2;
  const accepted = consent.checked;
  const approvedAdvance = candidate?.invoice.approvedAdvance ?? 0n;
  const exactAllowance = allowance === approvedAdvance;
  approveButton.disabled = Boolean(pendingHash) || !correctWallet || !registered || exactAllowance || balance < approvedAdvance || !accepted;
  fundButton.disabled = Boolean(pendingHash) || !correctWallet || !registered || !exactAllowance || balance < approvedAdvance || !accepted;
  if (correctWallet && registered && allowance > approvedAdvance) setError("Existing USDG allowance exceeds this invoice. Reset it before funding.");
  else if (correctWallet && registered && balance < approvedAdvance) setError("This wallet does not hold enough USDG for the exact advance.");
  if (funded) {
    completePanel.hidden = false;
    approveButton.disabled = true;
    fundButton.disabled = true;
  }
};

const waitForReceipt = async (hash) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const receipt = await publicRpc("eth_getTransactionReceipt", [hash]);
      if (receipt) return receipt;
    } catch {
      // The transaction hash is already authoritative. A transient read failure
      // must not turn a broadcast into a retryable action.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Transaction ${hash} was sent, but confirmation is still pending. Check it in the X Layer explorer before retrying.`);
};

const execute = async (action, button, busyText, idleText) => {
  setError();
  setBusy(button, true, "Checking exact action…", idleText);
  assertWalletContext(action, { account, chainId });
  if (!consent.checked) throw new Error("Confirm the real-value funding boundary first.");
  const invoiceResult = await publicRpc("eth_call", [{ to: OPENBELL_MAINNET_CONNECTED.receivables, data: buildInvoiceStateCall(action.invoiceId) }, "latest"]);
  assertActionAgainstInvoice(action, invoiceResult, Math.floor(Date.now() / 1_000));
  assertFundingCandidateAgainstInvoice(candidate, decodeInvoiceState(invoiceResult));
  if (action.kind === "FUND_INVOICE") {
    const allowanceResult = await publicRpc("eth_call", [{ to: OPENBELL_MAINNET_CONNECTED.settlementToken, data: buildAllowanceStateCall(candidate.invoice.funder) }, "latest"]);
    if (decodeAllowanceState(allowanceResult) !== action.amount) throw new Error("Funding requires an exact USDG allowance.");
  }
  const transaction = { from: action.signer, to: action.to, data: action.data, value: "0x0" };
  setBusy(button, true, "Simulating exact action…", idleText);
  await publicRpc("eth_call", [transaction, "latest"]);
  await publicRpc("eth_estimateGas", [transaction]);
  setBusy(button, true, "Confirm in wallet…", idleText);
  const hash = await rpc("eth_sendTransaction", [transaction]);
  pendingHash = hash;
  const receiptLink = document.querySelector("#fund-receipt");
  if (receiptLink) receiptLink.href = `${OPENBELL_MAINNET_CONNECTED.explorerTransactionBase}${hash}`;
  render();
  setBusy(button, true, "Waiting for X Layer…", idleText);
  const receipt = await waitForReceipt(hash);
  if (receipt.status !== "0x1") {
    pendingHash = undefined;
    render();
    throw new Error("The X Layer receipt reports failure.");
  }
  try {
    await refreshState();
    pendingHash = undefined;
    render();
  } catch {
    setError(`Transaction ${hash} is confirmed. Live state refresh is delayed; check the explorer before taking another action.`);
  }
  return hash;
};

connectButton.addEventListener("click", async () => {
  try {
    setError();
    await refreshWallet({ requestAccounts: true });
    if (chainId !== OPENBELL_MAINNET_CONNECTED.chainId) await switchToMainnet();
  } catch (error) { setError(error instanceof Error ? error.message : "Wallet connection failed."); }
});
consent.addEventListener("change", render);
approveButton.addEventListener("click", async () => {
  try { await execute(candidate.approvalAction, approveButton, "Approving…", "Approve exact USDG"); }
  catch (error) { setError(error instanceof Error ? error.message : "The exact approval was not executed."); }
  finally { setBusy(approveButton, false, "", "Approve exact USDG"); render(); }
});
fundButton.addEventListener("click", async () => {
  try {
    const hash = await execute(candidate.fundingAction, fundButton, "Funding…", "Fund invoice");
    const receiptLink = document.querySelector("#fund-receipt");
    receiptLink.href = `${OPENBELL_MAINNET_CONNECTED.explorerTransactionBase}${hash}`;
    completePanel.hidden = false;
    completePanel.focus();
  } catch (error) { setError(error instanceof Error ? error.message : "The invoice was not funded."); }
  finally { setBusy(fundButton, false, "", "Fund invoice"); render(); }
});
provider?.on?.("accountsChanged", () => refreshWallet().catch(() => render()));
provider?.on?.("chainChanged", () => refreshWallet().catch(() => render()));

try {
  const response = await fetch("/api/funding-candidate", { cache: "no-store" });
  if (!response.ok) throw new Error("No funding candidate is currently open.");
  candidate = await validateFundingCandidate(await response.json());
  setText("#candidate-title", candidate.title);
  setText("#candidate-summary", candidate.summary);
  setText("#candidate-face", usd(candidate.invoice.faceValue));
  setText("#candidate-advance", usd(candidate.invoice.approvedAdvance));
  setText("#candidate-repayment", usd(candidate.invoice.repaymentAmount));
  setText("#candidate-due", new Date(Number(candidate.invoice.dueDate) * 1_000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
  setText("#candidate-limit", `${(Number(candidate.invoice.approvedAdvance * 10_000n / candidate.invoice.requestedAdvance) / 100).toFixed(0)}% OF REQUEST`);
  setText("#required-wallet", candidate.invoice.funder);
  await refreshWallet();
} catch (error) {
  setText("#candidate-title", "No invoice is open for funding.");
  setText("#candidate-summary", "The next bounded mainnet receivable is being prepared. No wallet action is available yet.");
  setError(error instanceof Error ? error.message : "Funding candidate unavailable.");
  render();
}
