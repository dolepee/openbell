import { formatUnits } from "viem";
import {
  OPENBELL_TESTNET,
  addInvoiceSessionSignature,
  assertActionAgainstInvoice,
  assertWalletContext,
  buildInvoiceStateCall,
  buildConnectedAssessmentRequest,
  createInvoiceSession,
  walletInvoiceTypedData,
  walletConnectedAssessmentTypedData,
  registrationActionFromSession,
  validateBrowserAction,
  validateInvoiceSession
} from "../testnet-flow.mjs";

const provider = globalThis.ethereum;
const connectButton = document.querySelector("#connect-wallet");
const walletState = document.querySelector("#wallet-state");
const actionForm = document.querySelector("#action-form");
const actionFile = document.querySelector("#action-file");
const actionError = document.querySelector("#action-error");
const actionPanel = document.querySelector("#action-panel");
const executeButton = document.querySelector("#execute-action");
const receiptPanel = document.querySelector("#receipt-panel");
const receiptLink = document.querySelector("#receipt-link");
const sessionForm = document.querySelector("#session-form");
const sessionFile = document.querySelector("#session-file");
const sessionError = document.querySelector("#session-error");
const sessionPanel = document.querySelector("#session-panel");
const signInvoiceButton = document.querySelector("#sign-invoice");
const downloadSessionButton = document.querySelector("#download-session");
const downloadRegistrationButton = document.querySelector("#download-registration");
const assessmentWorkspace = document.querySelector("#assessment-workspace");
const assessmentForm = document.querySelector("#assessment-form");
const assessmentError = document.querySelector("#assessment-error");
const assessmentResult = document.querySelector("#assessment-result");

let account;
let chainId;
let action;
let invoiceSession;
let registrationTransactionHash;

const compact = (value) => `${value.slice(0, 10)}…${value.slice(-6)}`;
const setText = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
};
const setError = (message = "") => {
  actionError.textContent = message;
  actionFile.setAttribute("aria-invalid", message ? "true" : "false");
};
const setBusy = (busy, text) => {
  executeButton.disabled = busy || !action;
  executeButton.setAttribute("aria-busy", String(busy));
  executeButton.querySelector("span").textContent = text;
};
const rpc = (method, params = []) => {
  if (!provider?.request) throw new Error("No compatible browser wallet was found.");
  return provider.request({ method, params });
};

const refreshExecutionState = () => {
  if (!action || !account) return void (executeButton.disabled = true);
  try {
    assertWalletContext(action, { account, chainId });
    executeButton.disabled = false;
    setError();
  } catch (error) {
    executeButton.disabled = true;
    setError(error instanceof Error ? error.message : "Wallet context is invalid.");
  }
};
const refreshSessionState = () => {
  if (!invoiceSession) {
    signInvoiceButton.disabled = true;
    downloadSessionButton.disabled = true;
    downloadRegistrationButton.disabled = true;
    return;
  }
  const supplier = invoiceSession.dealPackage.invoiceTerms.supplier;
  const payer = invoiceSession.dealPackage.invoiceTerms.payer;
  const role = account?.toLowerCase() === supplier.toLowerCase() ? "supplierSignature"
    : account?.toLowerCase() === payer.toLowerCase() ? "payerSignature" : null;
  signInvoiceButton.disabled = !role || invoiceSession[role] !== null || chainId !== OPENBELL_TESTNET.chainId;
  downloadSessionButton.disabled = false;
  downloadRegistrationButton.disabled = invoiceSession.supplierSignature === null || invoiceSession.payerSignature === null;
};
const renderWallet = () => {
  const connected = Boolean(account);
  connectButton.textContent = connected ? compact(account) : "Connect wallet";
  walletState.textContent = !provider
    ? "Install an EIP-1193 wallet to use the connected desk."
    : connected ? `Connected · chain ${chainId ?? "unknown"}` : "No wallet connected. Nothing can be signed or sent.";
  connectButton.setAttribute("aria-pressed", String(connected));
  refreshExecutionState();
  refreshSessionState();
};
const refreshWallet = async ({ requestAccounts = false } = {}) => {
  if (!provider) return renderWallet();
  const accounts = await rpc(requestAccounts ? "eth_requestAccounts" : "eth_accounts");
  account = accounts[0];
  chainId = Number.parseInt(await rpc("eth_chainId"), 16);
  renderWallet();
};
const switchToTestnet = async () => {
  try {
    await rpc("wallet_switchEthereumChain", [{ chainId: OPENBELL_TESTNET.chainHex }]);
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await rpc("wallet_addEthereumChain", [{
      chainId: OPENBELL_TESTNET.chainHex,
      chainName: "X Layer Testnet",
      nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
      rpcUrls: ["https://testrpc.xlayer.tech/terigon"],
      blockExplorerUrls: ["https://www.okx.com/web3/explorer/xlayer-test"]
    }]);
  }
  await refreshWallet();
};

connectButton?.addEventListener("click", async () => {
  try {
    setError();
    await refreshWallet({ requestAccounts: true });
    if (chainId !== OPENBELL_TESTNET.chainId) await switchToTestnet();
  } catch (error) {
    setError(error instanceof Error ? error.message : "Wallet connection failed.");
  }
});

actionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError();
  action = undefined;
  actionPanel.hidden = true;
  receiptPanel.hidden = true;
  executeButton.disabled = true;
  try {
    const file = actionFile.files?.[0];
    if (!file) throw new Error("Select one OpenBell action package.");
    if (file.size > 64 * 1024) throw new Error("Action package exceeds the 64 KiB browser limit.");
    action = await validateBrowserAction(JSON.parse(await file.text()));
    setText("#action-kind", action.kind.replaceAll("_", " "));
    setText("#action-signer", action.signer);
    setText("#action-target", action.to);
    setText("#action-value", "0 OKB");
    setText("#action-amount", action.amount === null ? "Not applicable" : `${formatUnits(action.amount, 6)} fixture tUSDG`);
    setText("#action-calldata", compact(action.data));
    actionPanel.hidden = false;
    actionPanel.focus();
    refreshExecutionState();
  } catch (error) {
    setError(error instanceof Error ? error.message : "Action package is invalid.");
  }
});

const downloadJson = (name, value) => {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};
const renderSession = () => {
  const terms = invoiceSession.dealPackage.invoiceTerms;
  setText("#session-invoice", compact(terms.invoiceId));
  setText("#session-supplier", invoiceSession.supplierSignature ? "SIGNED" : "WAITING");
  setText("#session-payer", invoiceSession.payerSignature ? "SIGNED" : "WAITING");
  setText("#session-digest", compact(invoiceSession.authorizedDigest));
  sessionPanel.hidden = false;
  sessionPanel.focus();
  refreshSessionState();
};

sessionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  sessionError.textContent = "";
  try {
    const file = sessionFile.files?.[0];
    if (!file) throw new Error("Select one unsigned testnet deal or invoice session.");
    if (file.size > 256 * 1024) throw new Error("Invoice handoff exceeds the 256 KiB browser limit.");
    const parsed = JSON.parse(await file.text());
    invoiceSession = parsed.schemaVersion === "openbell-receivables-deal-preparation-v1"
      ? await createInvoiceSession(parsed) : await validateInvoiceSession(parsed);
    sessionFile.setAttribute("aria-invalid", "false");
    renderSession();
  } catch (error) {
    sessionFile.setAttribute("aria-invalid", "true");
    sessionError.textContent = error instanceof Error ? error.message : "Invoice handoff is invalid.";
  }
});

signInvoiceButton?.addEventListener("click", async () => {
  try {
    if (!invoiceSession || !account) throw new Error("Connect the supplier or payer wallet first.");
    if (chainId !== OPENBELL_TESTNET.chainId) await switchToTestnet();
    const typedData = walletInvoiceTypedData(invoiceSession.dealPackage.invoiceTerms);
    const json = JSON.stringify(typedData, (_, value) => typeof value === "bigint" ? value.toString() : value);
    const signature = await rpc("eth_signTypedData_v4", [account, json]);
    invoiceSession = await addInvoiceSessionSignature(invoiceSession, account, signature);
    renderSession();
  } catch (error) {
    sessionError.textContent = error instanceof Error ? error.message : "Invoice signature was not accepted.";
  }
});

downloadSessionButton?.addEventListener("click", () => {
  if (!invoiceSession) return;
  downloadJson(`openbell-invoice-session-${invoiceSession.dealPackage.invoiceTerms.invoiceId.slice(2, 14)}.json`, invoiceSession);
});
downloadRegistrationButton?.addEventListener("click", async () => {
  try {
    const registration = await registrationActionFromSession(invoiceSession);
    downloadJson(`openbell-register-${registration.payload.terms.invoiceId.slice(2, 14)}.json`, registration);
  } catch (error) {
    sessionError.textContent = error instanceof Error ? error.message : "Registration action is not ready.";
  }
});

const waitForReceipt = async (transactionHash) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const receipt = await rpc("eth_getTransactionReceipt", [transactionHash]);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("The transaction was sent but its receipt is not yet available.");
};

executeButton?.addEventListener("click", async () => {
  if (!action) return;
  try {
    setError();
    assertWalletContext(action, { account, chainId });
    setBusy(true, "Simulating exact action…");
    const executingAction = action;
    const transaction = { from: executingAction.signer, to: executingAction.to, data: executingAction.data, value: "0x0" };
    const invoiceResult = await rpc("eth_call", [{ to: OPENBELL_TESTNET.receivables, data: buildInvoiceStateCall(executingAction.invoiceId) }, "latest"]);
    assertActionAgainstInvoice(executingAction, invoiceResult, Math.floor(Date.now() / 1_000));
    await rpc("eth_call", [transaction, "latest"]);
    await rpc("eth_estimateGas", [transaction]);
    setBusy(true, "Confirm in wallet…");
    const transactionHash = await rpc("eth_sendTransaction", [transaction]);
    setBusy(true, "Waiting for receipt…");
    const receipt = await waitForReceipt(transactionHash);
    if (receipt.status !== "0x1") throw new Error("The transaction receipt reports failure.");
    receiptLink.href = `${OPENBELL_TESTNET.explorerTransactionBase}${transactionHash}`;
    receiptLink.textContent = compact(transactionHash);
    receiptPanel.hidden = false;
    receiptPanel.focus();
    if (executingAction.kind === "REGISTER_INVOICE" && invoiceSession) {
      registrationTransactionHash = transactionHash;
      assessmentWorkspace.hidden = false;
    }
    action = undefined;
    executeButton.disabled = true;
    setBusy(false, "Action confirmed");
  } catch (error) {
    setBusy(false, "Simulate and continue");
    setError(error instanceof Error ? error.message : "The exact action was not executed.");
  }
});

const historyValue = (selector) => Number(document.querySelector(selector).value);
assessmentForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  assessmentError.textContent = "";
  assessmentResult.hidden = true;
  const button = document.querySelector("#request-assessment");
  try {
    if (!invoiceSession || !registrationTransactionHash) throw new Error("Confirm the registration transaction first.");
    if (!account || account.toLowerCase() !== invoiceSession.dealPackage.invoiceTerms.supplier.toLowerCase()) throw new Error("Connect the registered supplier wallet.");
    if (chainId !== OPENBELL_TESTNET.chainId) await switchToTestnet();
    if (!document.querySelector("#assessment-consent").checked) throw new Error("Confirm the single-attempt model boundary.");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Authorizing supplier request…";
    const fields = {
      session: invoiceSession,
      registrationTransactionHash,
      funder: document.querySelector("#assessment-funder").value.trim(),
      payerHistory: {
        completedSettlements: historyValue("#history-completed"),
        onTimeSettlements: historyValue("#history-ontime"),
        lateSettlements: historyValue("#history-late"),
        defaults: historyValue("#history-defaults"),
        concentrationBps: historyValue("#history-concentration"),
        daysSinceLastSettlement: historyValue("#history-days")
      },
      redactedContext: document.querySelector("#assessment-context").value
    };
    const unsigned = await buildConnectedAssessmentRequest(fields);
    const signingPayload = walletConnectedAssessmentTypedData(unsigned);
    const signingJson = JSON.stringify(signingPayload, (_, value) => typeof value === "bigint" ? value.toString() : value);
    const supplierAuthorization = await rpc("eth_signTypedData_v4", [account, signingJson]);
    const authorized = await buildConnectedAssessmentRequest({ ...fields, supplierAuthorization });
    button.textContent = "Verifying chain and assessing…";
    const response = await fetch("/api/connected-underwriting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authorized)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error ?? `Underwriting returned HTTP ${response.status}.`);
    if (!result?.decision || !result?.modelEvidence || !Array.isArray(result.actions)) throw new Error("Underwriting response is incomplete.");
    if (result.modelEvidence.decision?.verdict !== result.decision.verdict) throw new Error("Model evidence and bounded decision disagree.");
    const validatedActions = await Promise.all(result.actions.map(validateBrowserAction));
    if (validatedActions.some((item) => item.invoiceId !== invoiceSession.dealPackage.invoiceTerms.invoiceId)) throw new Error("Decision actions target a different invoice.");
    setText("#assessment-verdict", result.decision.verdict === "REJECT" ? "Invoice rejected." : "Bounded terms approved.");
    setText("#assessment-economics", result.decision.verdict === "REJECT" ? "Zero funding actions were produced." : `${formatUnits(BigInt(result.decision.advanceAmount), 6)} fixture tUSDG advance · ${formatUnits(BigInt(result.decision.repaymentAmount), 6)} due`);
    setText("#assessment-provider", `${result.modelEvidence.requestedModel} · response ${compact(result.modelEvidence.providerResponseId)} · first attempt sealed`);
    const actionsNode = document.querySelector("#assessment-actions");
    actionsNode.replaceChildren(...result.actions.map((item, index) => {
      const download = document.createElement("button");
      download.type = "button";
      download.className = "button button-secondary";
      download.textContent = `Download ${item.kind.replaceAll("_", " ").toLowerCase()}`;
      download.addEventListener("click", () => downloadJson(`openbell-${index + 1}-${item.kind.toLowerCase()}.json`, item));
      return download;
    }));
    assessmentResult.hidden = false;
    assessmentResult.focus();
  } catch (error) {
    assessmentError.textContent = error instanceof Error ? error.message : "The assessment was not completed.";
  } finally {
    button.disabled = false;
    button.setAttribute("aria-busy", "false");
    button.textContent = "Authorize one assessment";
  }
});

provider?.on?.("accountsChanged", () => refreshWallet().catch(() => undefined));
provider?.on?.("chainChanged", () => refreshWallet().catch(() => undefined));
refreshWallet().catch(() => renderWallet());
