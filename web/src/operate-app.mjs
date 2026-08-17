import { formatUnits } from "viem";
import {
  OPENBELL_MAINNET_CONNECTED,
  OPENBELL_TESTNET,
  addInvoiceSessionSignature,
  assertActionAgainstInvoice,
  assertRegistrationNoncesAvailable,
  assertFixtureClaimAvailable,
  assertFixtureClaimCompleted,
  assertWalletContext,
  buildFixtureClaimStateCalls,
  buildInvoiceStateCall,
  buildPartyNonceStateCall,
  buildConnectedAssessmentRequest,
  connectedDecisionTypedData,
  createFixtureClaimAction,
  createInvoiceSession,
  finalizeConnectedAssessment,
  walletInvoiceTypedData,
  walletConnectedAssessmentTypedData,
  registrationActionFromSession,
  validateBrowserAction,
  validateConnectedAssessment,
  validateConnectedPolicyRefusal,
  validateInvoiceSession
} from "../testnet-flow.mjs";

const isMainnet = document.body.dataset.network === "mainnet" || globalThis.location?.pathname.startsWith("/mainnet");
const ACTIVE_DEPLOYMENT = isMainnet ? OPENBELL_MAINNET_CONNECTED : OPENBELL_TESTNET;
const ACTIVE_TOKEN_LABEL = isMainnet ? "USDG" : "fixture tUSDG";
const UNDERWRITING_ENDPOINT = isMainnet ? "/api/mainnet-underwriting" : "/api/connected-underwriting";

const configureMainnetSurface = () => {
  if (!isMainnet) return;
  document.body.dataset.network = "mainnet";
  document.title = "Live USDG desk — OpenBell";
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", "https://openbell.dolepee.com/mainnet/");
  document.querySelector('meta[name="description"]')?.setAttribute("content", "A fail-closed browser desk for exact OpenBell actions using real USDG on X Layer mainnet.");
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", "https://openbell.dolepee.com/mainnet/");
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", "OpenBell live USDG desk");
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", "A bounded receivables journey where AI proposes terms and X Layer enforces the smallest authorized amount.");
  const status = document.querySelector(".status-bar");
  if (status) status.innerHTML = "<span><i class=\"status-dot\"></i> XLAYER MAINNET</span><span>REAL USDG</span><span>EXACT ACTIONS ONLY</span>";
  const currentNav = document.querySelector('.desktop-nav a[aria-current="page"]');
  if (currentNav) { currentNav.href = "/mainnet/"; currentNav.textContent = "Live USDG desk"; }
  const hero = document.querySelector(".operate-hero");
  if (hero) hero.innerHTML = '<div><p class="overline">OPENBELL · LIVE USDG EXECUTION</p><h1>AI proposes.<br />X Layer limits.</h1></div><p>Prepare a real receivable, bind supplier and payer signatures, and move only the smallest amount permitted by the supplier request, AI decision, and immutable 80% contract ceiling.</p>';
  const readiness = document.querySelector(".operate-readiness");
  if (readiness) readiness.innerHTML = '<div class="readiness-copy"><p class="overline">BEFORE REAL VALUE MOVES</p><h2 id="readiness-title">Three independent roles. One genuine receivable.</h2><p>The supplier, payer, and funder must use distinct X Layer mainnet addresses. The payer acknowledges the underlying invoice; the funder provides canonical USDG only after the bounded decision is signed.</p></div><ol><li><span>01</span><div><strong>Prepare the genuine invoice</strong><small>Commit the source document locally; OpenBell never uploads it.</small></div></li><li><span>02</span><div><strong>Supplier and payer sign</strong><small>Both wallets authorize the same numeric chain-196 EIP-712 terms.</small></div></li><li><span>03</span><div><strong>Run bounded underwriting</strong><small>AI may tighten or refuse the request; it cannot exceed the contract ceiling.</small></div></li><li><span>04</span><div><strong>Fund and settle in USDG</strong><small>Every transaction is simulated, role-bound, and confirmed on X Layer.</small></div></li></ol><div class="readiness-actions"><a class="button button-primary" href="/studio/?target=mainnet">Prepare mainnet deal</a><a class="button button-secondary" href="/proof/" rel="noreferrer">Inspect deployment proof ↗</a></div>';
  const fixtureControl = document.querySelector(".fixture-claim-control");
  if (fixtureControl) fixtureControl.hidden = true;
  const sessionCopy = document.querySelector(".session-load > p:not(.overline)");
  if (sessionCopy) sessionCopy.textContent = "Load a mainnet deal from the Studio, or continue the exact session received from the other party. The document stays local; each wallet signs the same chain-196 digest.";
  const sessionHelp = document.querySelector("#session-help");
  if (sessionHelp) sessionHelp.textContent = "Only the verified chain-196 OpenBell contract and canonical USDG are accepted.";
  const walletCard = document.querySelector(".operate-grid .operate-card");
  if (walletCard) {
    walletCard.querySelector("header b").textContent = "CHAIN 196";
    walletCard.querySelector("h2").textContent = "Bring the exact role wallet.";
    const note = walletCard.querySelector(":scope > small");
    if (note) note.textContent = "Supplier registers or rejects. Funder approves and funds with USDG. Payer approves and settles. No wallet can act for another role.";
  }
  const amountLabel = document.querySelector("#action-amount")?.closest("div")?.querySelector("dt");
  if (amountLabel) amountLabel.textContent = "USDG amount";
  const receiptCopy = document.querySelector(".operate-receipt > p");
  if (receiptCopy) receiptCopy.textContent = "The transaction landed on X Layer mainnet. Open the receipt and verify the exact contract, signer, and canonical USDG amount.";
  const assessmentContext = document.querySelector("#assessment-context");
  if (assessmentContext) assessmentContext.value = "Authorized evidence for a genuine receivable. No confidential document content is included.";
  const boundary = document.querySelector(".operate-boundary");
  if (boundary) boundary.innerHTML = '<div><p class="overline">LIVE PRODUCT BOUNDARY</p><h2 id="operate-boundary-title">Real settlement, bounded authority.</h2></div><p>OpenBell verifies signatures, observes confirmed registration through two official RPCs, obtains one genuine model response, and reconstructs exact USDG actions. It does not verify legal invoice validity, guarantee financing, or let the model custody funds.</p>';
};

configureMainnetSurface();

const provider = globalThis.ethereum;
const connectButton = document.querySelector("#connect-wallet");
const walletState = document.querySelector("#wallet-state");
const claimFixtureButton = document.querySelector("#claim-fixture-tokens");
const fixtureClaimState = document.querySelector("#fixture-claim-state");
const fixtureClaimError = document.querySelector("#fixture-claim-error");
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
const signDecisionButton = document.querySelector("#sign-decision");
const downloadAssessmentButton = document.querySelector("#download-assessment");

let account;
let chainId;
let action;
let invoiceSession;
let registrationTransactionHash;
let pendingAssessment;
let pendingAssessmentRequest;
let pendingPolicyRefusal;
let pendingPolicyRefusalRequest;
let pendingPolicyRefusalArtifactHash;

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
const setFixtureClaimBusy = (busy, text) => {
  if (!claimFixtureButton) return;
  claimFixtureButton.disabled = isMainnet || busy || !account || chainId !== OPENBELL_TESTNET.chainId;
  claimFixtureButton.setAttribute("aria-busy", String(busy));
  claimFixtureButton.textContent = text;
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
  signInvoiceButton.disabled = !role || invoiceSession[role] !== null || chainId !== ACTIVE_DEPLOYMENT.chainId;
  downloadSessionButton.disabled = false;
  downloadRegistrationButton.disabled = invoiceSession.supplierSignature === null || invoiceSession.payerSignature === null;
};
const refreshDecisionState = () => {
  const expected = pendingAssessment?.signingRequest?.underwriter?.toLowerCase();
  signDecisionButton.disabled = !expected || account?.toLowerCase() !== expected || chainId !== ACTIVE_DEPLOYMENT.chainId;
  downloadAssessmentButton.disabled = !pendingAssessment && !pendingPolicyRefusal;
};
const renderWallet = () => {
  const connected = Boolean(account);
  connectButton.textContent = connected ? compact(account) : "Connect wallet";
  walletState.textContent = !provider
    ? "Install an EIP-1193 wallet to use the connected desk."
    : connected ? `Connected · chain ${chainId ?? "unknown"}` : "No wallet connected. Nothing can be signed or sent.";
  connectButton.setAttribute("aria-pressed", String(connected));
  if (!isMainnet) setFixtureClaimBusy(false, "Review fixture tUSDG claim");
  refreshExecutionState();
  refreshSessionState();
  refreshDecisionState();
};
const refreshWallet = async ({ requestAccounts = false } = {}) => {
  if (!provider) return renderWallet();
  const accounts = await rpc(requestAccounts ? "eth_requestAccounts" : "eth_accounts");
  account = accounts[0];
  chainId = Number.parseInt(await rpc("eth_chainId"), 16);
  renderWallet();
};
const switchToActiveNetwork = async () => {
  try {
    await rpc("wallet_switchEthereumChain", [{ chainId: ACTIVE_DEPLOYMENT.chainHex }]);
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await rpc("wallet_addEthereumChain", [{
      chainId: ACTIVE_DEPLOYMENT.chainHex,
      chainName: isMainnet ? "X Layer Mainnet" : "X Layer Testnet",
      nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
      rpcUrls: [isMainnet ? "https://rpc.xlayer.tech" : "https://testrpc.xlayer.tech/terigon"],
      blockExplorerUrls: [isMainnet ? "https://www.okx.com/web3/explorer/xlayer" : "https://www.okx.com/web3/explorer/xlayer-test"]
    }]);
  }
  await refreshWallet();
};

connectButton?.addEventListener("click", async () => {
  try {
    setError();
    await refreshWallet({ requestAccounts: true });
    if (chainId !== ACTIVE_DEPLOYMENT.chainId) await switchToActiveNetwork();
  } catch (error) {
    setError(error instanceof Error ? error.message : "Wallet connection failed.");
  }
});

const renderAction = () => {
  setText("#action-kind", action.kind.replaceAll("_", " "));
  setText("#action-signer", action.signer);
  setText("#action-target", action.to);
  setText("#action-value", "0 OKB");
  setText("#action-amount", action.amount === null ? "Not applicable" : `${formatUnits(action.amount, 6)} ${ACTIVE_TOKEN_LABEL}`);
  setText("#action-calldata", compact(action.data));
  actionPanel.hidden = false;
  actionPanel.focus();
  refreshExecutionState();
};

claimFixtureButton?.addEventListener("click", async () => {
  fixtureClaimError.textContent = "";
  receiptPanel.hidden = true;
  try {
    if (!account) throw new Error("Connect the funder or payer account first.");
    if (isMainnet) throw new Error("Fixture-token claims are unavailable on mainnet.");
    if (chainId !== OPENBELL_TESTNET.chainId) await switchToActiveNetwork();
    action = await createFixtureClaimAction(account);
    renderAction();
  } catch (error) {
    fixtureClaimError.textContent = error instanceof Error ? error.message : "Fixture-token claim could not be prepared.";
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
    renderAction();
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
    if (!file) throw new Error(`Select one unsigned ${isMainnet ? "mainnet" : "testnet"} deal or invoice session.`);
    if (file.size > 256 * 1024) throw new Error("Invoice handoff exceeds the 256 KiB browser limit.");
    const parsed = JSON.parse(await file.text());
    invoiceSession = parsed.schemaVersion === "openbell-receivables-deal-preparation-v1"
      ? await createInvoiceSession(parsed) : await validateInvoiceSession(parsed);
    registrationTransactionHash = undefined;
    pendingAssessment = undefined;
    pendingAssessmentRequest = undefined;
    pendingPolicyRefusal = undefined;
    pendingPolicyRefusalRequest = undefined;
    pendingPolicyRefusalArtifactHash = undefined;
    assessmentWorkspace.hidden = true;
    assessmentResult.hidden = true;
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
    if (chainId !== ACTIVE_DEPLOYMENT.chainId) await switchToActiveNetwork();
    const typedData = walletInvoiceTypedData(invoiceSession.dealPackage.invoiceTerms, ACTIVE_DEPLOYMENT);
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
  const isFixtureClaim = action.kind === "CLAIM_FIXTURE_TOKENS";
  try {
    setError();
    assertWalletContext(action, { account, chainId });
    setBusy(true, "Simulating exact action…");
    const executingAction = action;
    const transaction = { from: executingAction.signer, to: executingAction.to, data: executingAction.data, value: "0x0" };
    let fixtureClaimBefore;
    if (isFixtureClaim) {
      const calls = buildFixtureClaimStateCalls(executingAction.signer);
      const [hasClaimedResult, balanceResult, faucetAmountResult] = await Promise.all([
        rpc("eth_call", [{ to: OPENBELL_TESTNET.settlementToken, data: calls.hasClaimed }, "latest"]),
        rpc("eth_call", [{ to: OPENBELL_TESTNET.settlementToken, data: calls.balance }, "latest"]),
        rpc("eth_call", [{ to: OPENBELL_TESTNET.settlementToken, data: calls.faucetAmount }, "latest"])
      ]);
      fixtureClaimBefore = assertFixtureClaimAvailable(executingAction, { hasClaimedResult, balanceResult, faucetAmountResult });
    } else {
      const invoiceResult = await rpc("eth_call", [{ to: ACTIVE_DEPLOYMENT.receivables, data: buildInvoiceStateCall(executingAction.invoiceId) }, "latest"]);
      assertActionAgainstInvoice(executingAction, invoiceResult, Math.floor(Date.now() / 1_000));
      if (executingAction.kind === "REGISTER_INVOICE") {
        const terms = executingAction.registration;
        const [supplierNonceResult, payerNonceResult] = await Promise.all([
          rpc("eth_call", [{ to: ACTIVE_DEPLOYMENT.receivables, data: buildPartyNonceStateCall(terms.supplier, terms.nonce) }, "latest"]),
          rpc("eth_call", [{ to: ACTIVE_DEPLOYMENT.receivables, data: buildPartyNonceStateCall(terms.payer, terms.nonce) }, "latest"])
        ]);
        assertRegistrationNoncesAvailable(executingAction, supplierNonceResult, payerNonceResult);
      }
    }
    await rpc("eth_call", [transaction, "latest"]);
    await rpc("eth_estimateGas", [transaction]);
    setBusy(true, "Confirm in wallet…");
    const transactionHash = await rpc("eth_sendTransaction", [transaction]);
    setBusy(true, "Waiting for receipt…");
    const receipt = await waitForReceipt(transactionHash);
    if (receipt.status !== "0x1") throw new Error("The transaction receipt reports failure.");
    if (isFixtureClaim) {
      if (!receipt.blockNumber) throw new Error("The confirmed fixture-token receipt is missing its block number.");
      const calls = buildFixtureClaimStateCalls(executingAction.signer);
      const [hasClaimedResult, balanceResult] = await Promise.all([
        rpc("eth_call", [{ to: OPENBELL_TESTNET.settlementToken, data: calls.hasClaimed }, receipt.blockNumber]),
        rpc("eth_call", [{ to: OPENBELL_TESTNET.settlementToken, data: calls.balance }, receipt.blockNumber])
      ]);
      const completed = assertFixtureClaimCompleted(executingAction, { hasClaimedResult, balanceResult }, fixtureClaimBefore.balance);
      fixtureClaimState.textContent = `Claim confirmed · ${formatUnits(completed.balance, 6)} fixture tUSDG available.`;
      setFixtureClaimBusy(false, "Fixture tUSDG claimed");
      claimFixtureButton.disabled = true;
    }
    receiptLink.href = `${ACTIVE_DEPLOYMENT.explorerTransactionBase}${transactionHash}`;
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
    if (isFixtureClaim) fixtureClaimError.textContent = error instanceof Error ? error.message : "Fixture-token claim failed.";
  }
});

assessmentForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  assessmentError.textContent = "";
  assessmentResult.hidden = true;
  pendingAssessment = undefined;
  pendingAssessmentRequest = undefined;
  pendingPolicyRefusal = undefined;
  pendingPolicyRefusalRequest = undefined;
  pendingPolicyRefusalArtifactHash = undefined;
  signDecisionButton.hidden = false;
  downloadAssessmentButton.textContent = "Download unsigned assessment";
  refreshDecisionState();
  const button = document.querySelector("#request-assessment");
  try {
    if (!invoiceSession || !registrationTransactionHash) throw new Error("Confirm the registration transaction first.");
    if (!account || account.toLowerCase() !== invoiceSession.dealPackage.invoiceTerms.supplier.toLowerCase()) throw new Error("Connect the registered supplier wallet.");
    if (chainId !== ACTIVE_DEPLOYMENT.chainId) await switchToActiveNetwork();
    if (!document.querySelector("#assessment-consent").checked) throw new Error("Confirm the single-attempt model boundary.");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Authorizing supplier request…";
    const fields = {
      session: invoiceSession,
      registrationTransactionHash,
      funder: document.querySelector("#assessment-funder").value.trim(),
      payerHistory: {
        completedSettlements: 0,
        onTimeSettlements: 0,
        lateSettlements: 0,
        defaults: 0,
        concentrationBps: 0,
        daysSinceLastSettlement: 0
      },
      redactedContext: document.querySelector("#assessment-context").value
    };
    const unsigned = await buildConnectedAssessmentRequest(fields);
    const signingPayload = walletConnectedAssessmentTypedData(unsigned);
    const signingJson = JSON.stringify(signingPayload, (_, value) => typeof value === "bigint" ? value.toString() : value);
    const supplierAuthorization = await rpc("eth_signTypedData_v4", [account, signingJson]);
    const authorized = await buildConnectedAssessmentRequest({ ...fields, supplierAuthorization });
    button.textContent = "Verifying chain and assessing…";
    const response = await fetch(UNDERWRITING_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authorized)
    });
    const result = await response.json();
    if (invoiceSession?.dealPackage?.invoiceTerms?.invoiceId?.toLowerCase() !== authorized.invoiceId.toLowerCase()) throw new Error("The active invoice changed while underwriting was in progress.");
    if (response.status === 422 && result?.error === "CONNECTED_POLICY_REFUSAL") {
      pendingPolicyRefusal = validateConnectedPolicyRefusal(result.policyRefusal, authorized, result.policyRefusalArtifactHash);
      pendingPolicyRefusalRequest = authorized;
      pendingPolicyRefusalArtifactHash = result.policyRefusalArtifactHash;
      setText("#assessment-verdict", "Policy refused · no execution authority.");
      setText("#assessment-economics", `${pendingPolicyRefusal.refusal.code} · ${pendingPolicyRefusal.refusal.message}`);
      setText("#assessment-provider", `${pendingPolicyRefusal.modelEvidence.requestedModel} · response ${compact(pendingPolicyRefusal.modelEvidence.providerResponseId)} · exact refusal evidence sealed`);
      document.querySelector("#assessment-actions").replaceChildren();
      signDecisionButton.hidden = true;
      downloadAssessmentButton.textContent = "Download refusal evidence";
      refreshDecisionState();
      assessmentResult.hidden = false;
      assessmentResult.focus();
      return;
    }
    if (!response.ok) throw new Error(result?.error ?? `Underwriting returned HTTP ${response.status}.`);
    if (!result?.decision || !result?.modelEvidence || !result?.signingRequest) throw new Error("Underwriting response is incomplete.");
    if (result.modelEvidence.decision?.verdict !== result.decision.verdict) throw new Error("Model evidence and bounded decision disagree.");
    validateConnectedAssessment(result, authorized);
    pendingAssessment = result;
    pendingAssessmentRequest = authorized;
    setText("#assessment-verdict", result.decision.verdict === "REJECT" ? "Rejection assessed · awaiting underwriter." : "Terms assessed · awaiting underwriter.");
    setText("#assessment-economics", result.decision.verdict === "REJECT" ? "No execution authority exists until the underwriter signs." : `${formatUnits(BigInt(result.decision.advanceAmount), 6)} ${ACTIVE_TOKEN_LABEL} advance · ${formatUnits(BigInt(result.decision.repaymentAmount), 6)} due · unsigned`);
    setText("#assessment-provider", `${result.modelEvidence.requestedModel} · response ${compact(result.modelEvidence.providerResponseId)} · first attempt sealed`);
    const actionsNode = document.querySelector("#assessment-actions");
    actionsNode.replaceChildren();
    refreshDecisionState();
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

downloadAssessmentButton?.addEventListener("click", () => {
  assessmentError.textContent = "";
  try {
    if (pendingPolicyRefusal && pendingPolicyRefusalRequest && pendingPolicyRefusalArtifactHash) {
      validateConnectedPolicyRefusal(pendingPolicyRefusal, pendingPolicyRefusalRequest, pendingPolicyRefusalArtifactHash);
      if (invoiceSession?.dealPackage?.invoiceTerms?.invoiceId?.toLowerCase() !== pendingPolicyRefusalRequest.invoiceId.toLowerCase()) throw new Error("The active invoice changed after underwriting.");
      downloadJson("openbell-policy-refusal.json", {
        policyRefusal: pendingPolicyRefusal,
        artifactHash: pendingPolicyRefusalArtifactHash
      });
    } else if (pendingAssessment && pendingAssessmentRequest) {
      validateConnectedAssessment(pendingAssessment, pendingAssessmentRequest);
      if (invoiceSession?.dealPackage?.invoiceTerms?.invoiceId?.toLowerCase() !== pendingAssessmentRequest.invoiceId.toLowerCase()) throw new Error("The active invoice changed after underwriting.");
      downloadJson("openbell-unsigned-assessment.json", pendingAssessment);
    }
  } catch (error) {
    assessmentError.textContent = error instanceof Error ? error.message : "The assessment could not be downloaded.";
  }
});

signDecisionButton?.addEventListener("click", async () => {
  assessmentError.textContent = "";
  try {
    if (!pendingAssessment || !pendingAssessmentRequest) throw new Error("No unsigned assessment is ready.");
    validateConnectedAssessment(pendingAssessment, pendingAssessmentRequest);
    if (invoiceSession?.dealPackage?.invoiceTerms?.invoiceId?.toLowerCase() !== pendingAssessmentRequest.invoiceId.toLowerCase()) throw new Error("The active invoice changed after underwriting.");
    if (chainId !== ACTIVE_DEPLOYMENT.chainId) await switchToActiveNetwork();
    if (account?.toLowerCase() !== pendingAssessment.signingRequest.underwriter.toLowerCase()) throw new Error("Connect the current underwriter wallet.");
    signDecisionButton.disabled = true;
    signDecisionButton.textContent = "Awaiting underwriter signature…";
    const typedData = connectedDecisionTypedData(pendingAssessment);
    const signingJson = JSON.stringify(typedData, (_, value) => typeof value === "bigint" ? value.toString() : value);
    const underwriterSignature = await rpc("eth_signTypedData_v4", [account, signingJson]);
    const actions = await finalizeConnectedAssessment(pendingAssessment, underwriterSignature);
    const validated = await Promise.all(actions.map(validateBrowserAction));
    if (validated.some((item) => item.invoiceId !== invoiceSession.dealPackage.invoiceTerms.invoiceId)) throw new Error("Decision actions target a different invoice.");
    setText("#assessment-verdict", pendingAssessment.decision.verdict === "REJECT" ? "Rejection approved by underwriter." : "Bounded terms approved by underwriter.");
    const actionsNode = document.querySelector("#assessment-actions");
    actionsNode.replaceChildren(...actions.map((item, index) => {
      const download = document.createElement("button");
      download.type = "button";
      download.className = "button button-secondary";
      download.textContent = `Download ${item.kind.replaceAll("_", " ").toLowerCase()}`;
      download.addEventListener("click", () => downloadJson(`openbell-${index + 1}-${item.kind.toLowerCase()}.json`, item));
      return download;
    }));
  } catch (error) {
    assessmentError.textContent = error instanceof Error ? error.message : "The decision was not signed.";
  } finally {
    signDecisionButton.textContent = "Approve decision as underwriter";
    refreshDecisionState();
  }
});

provider?.on?.("accountsChanged", () => refreshWallet().catch(() => undefined));
provider?.on?.("chainChanged", () => refreshWallet().catch(() => undefined));
refreshWallet().catch(() => renderWallet());
