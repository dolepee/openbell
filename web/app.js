import { OPENBELL_MAINNET, OPENBELL_TESTNET_TARGET, baseUnitsToDecimal, buildUnsignedDealPackage, calculateDealEconomics, createPreparationGuard, sha256, validateUnsignedDealPackage } from "/deal-package.mjs";

const compact = (value) => value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

const executionNext = document.querySelector("#execution-next");
const executionValue = document.querySelector("#execution-value");
const executionUnit = document.querySelector("#execution-unit");
const executionStatus = document.querySelector("#execution-status");
const executionSteps = [...document.querySelectorAll("[data-execution-step]")];

const executionJourney = [
  { value: "$100.00", unit: "dual-signed invoice", status: "The supplier and payer bind the invoice terms through EIP-712 signatures." },
  { value: "85% / 1%", unit: "model ceiling / fee", status: "The genuine first model response approves a maximum 85% advance and a 1% fee." },
  { value: "$75.00", unit: "effective advance", status: "The contract resolves min(75 requested, 85 model, 80 immutable contract) to exactly 75." },
  { value: "+$75.00", unit: "fixture tUSDG funded", status: "The funder transfers exactly 75 fixture tUSDG and the invoice enters FUNDED." },
  { value: "$75.75", unit: "repaid to funder", status: "The payer settles exactly 75.75 and the invoice reaches terminal state SETTLED." }
];

let executionIndex = 0;
const renderExecution = () => {
  if (!executionNext) return;
  const step = executionJourney[executionIndex];
  executionValue.textContent = step.value;
  executionUnit.textContent = step.unit;
  executionStatus.textContent = step.status;
  executionSteps.forEach((item, index) => {
    if (index === executionIndex) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    if (index < executionIndex) item.dataset.complete = "true";
    else delete item.dataset.complete;
  });
  executionNext.querySelector("span").textContent = executionIndex === executionJourney.length - 1 ? "Replay lifecycle" : "Advance replay";
};

if (executionNext) {
  executionNext.addEventListener("click", () => {
    executionIndex = (executionIndex + 1) % executionJourney.length;
    renderExecution();
  });
  renderExecution();
}

const invoices = {
  approved: {
    kicker: "INVOICE OB-APPROVED",
    title: "Strong payer receivable",
    state: "APPROVED",
    stateClass: "state-approved",
    face: "$100.00",
    requested: "$75.00",
    decision: "85% MAX",
    fee: "1.00%",
    rationale: "The payer profile supports approval within conservative parameters. The model proposed an 85% maximum advance and 1% fee.",
    hash: "0x37a50eb18ba205b83a5ec48568a935bcc2dcd7da0b9065cbd1a420aa82c60f38",
    rejected: false
  },
  rejected: {
    kicker: "INVOICE OB-REJECTED",
    title: "Prior-default payer receivable",
    state: "REJECTED",
    stateClass: "state-rejected",
    face: "$100.00",
    requested: "$75.00",
    decision: "REJECT",
    fee: "—",
    rationale: "The genuine first response rejected the synthetic payer after the supplied evidence disclosed a prior default. No funding terms were emitted.",
    hash: "0x2eabbde55a2bbcfaab0533bf29629155de60f682b9e530b7340d5c9f3f822967",
    rejected: true
  }
};

const invoiceButtons = [...document.querySelectorAll("[data-invoice]")];
const invoiceState = document.querySelector("#invoice-state");
const limitResolver = document.querySelector("#limit-resolver");
const setText = (selector, value) => {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
};

const renderInvoice = (key) => {
  const invoice = invoices[key];
  if (!invoice || !invoiceState) return;
  setText("#invoice-kicker", invoice.kicker);
  setText("#invoice-title", invoice.title);
  setText("#face-value", invoice.face);
  setText("#requested-value", invoice.requested);
  setText("#model-decision", invoice.decision);
  setText("#fee-value", invoice.fee);
  setText("#model-rationale", invoice.rationale);
  setText("#response-hash", invoice.hash);
  invoiceState.textContent = invoice.state;
  invoiceState.className = invoice.stateClass;
  limitResolver?.classList.toggle("is-rejected", invoice.rejected);
  invoiceButtons.forEach((button) => {
    const active = button.dataset.invoice === key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
};

invoiceButtons.forEach((button) => button.addEventListener("click", () => renderInvoice(button.dataset.invoice)));

const creditMemo = document.querySelector("#credit-memo");
const reviewEmpty = document.querySelector("#review-empty");
const reviewForm = document.querySelector("#review-form");
const studioOperationGuard = createPreparationGuard();
const clearCreditMemo = () => {
  if (creditMemo) creditMemo.hidden = true;
  if (reviewEmpty) reviewEmpty.hidden = false;
};

const dealForm = document.querySelector("#deal-form");
if (dealForm) {
  const supplierInput = document.querySelector("#deal-supplier");
  const payerInput = document.querySelector("#deal-payer");
  const faceInput = document.querySelector("#deal-face");
  const requestInput = document.querySelector("#deal-request");
  const dueInput = document.querySelector("#deal-due");
  const nonceInput = document.querySelector("#deal-nonce");
  const targetInput = document.querySelector("#deal-target");
  const requestedTarget = new URL(globalThis.location.href).searchParams.get("target");
  if (requestedTarget === "mainnet" || requestedTarget === "testnet") targetInput.value = requestedTarget;
  const faceSymbol = document.querySelector("#deal-face-symbol");
  const requestSymbol = document.querySelector("#deal-request-symbol");
  const documentInput = document.querySelector("#deal-document");
  const documentHashInput = document.querySelector("#deal-document-hash");
  const consentInput = document.querySelector("#deal-synthetic");
  const errorOutput = document.querySelector("#deal-error");
  const packageState = document.querySelector("#package-state");
  const packageInvoiceId = document.querySelector("#package-invoice-id");
  const packageDocumentHash = document.querySelector("#package-document-hash");
  const downloadPackage = document.querySelector("#download-package");
  let preparedPackage = null;

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 30);
  dueInput.value = tomorrow.toISOString().slice(0, 10);

  const invalidatePreparedPackage = () => {
    studioOperationGuard.invalidate();
    dealForm.setAttribute("aria-busy", "false");
    reviewForm?.setAttribute("aria-busy", "false");
    preparedPackage = null;
    downloadPackage.disabled = true;
    packageState.textContent = "DRAFT";
    packageInvoiceId.textContent = "—";
    packageDocumentHash.textContent = "—";
    delete document.querySelector('[data-readiness="terms"]').dataset.complete;
    delete document.querySelector('[data-readiness="document"]').dataset.complete;
    clearCreditMemo();
  };

  const renderTargetLabels = () => {
    const target = targetInput.value === "testnet" ? OPENBELL_TESTNET_TARGET : OPENBELL_MAINNET;
    faceSymbol.textContent = target.settlementTokenSymbol;
    requestSymbol.textContent = target.settlementTokenSymbol;
  };

  const renderStudioMath = () => {
    try {
      const economics = calculateDealEconomics(faceInput.value, requestInput.value);
      document.querySelector("#studio-face").textContent = baseUnitsToDecimal(economics.faceValue);
      document.querySelector("#studio-request").textContent = baseUnitsToDecimal(economics.requestedAdvance);
      document.querySelector("#studio-contract-max").textContent = baseUnitsToDecimal(economics.immutableMaximumAdvance);
      document.querySelector("#studio-upper-bound").textContent = baseUnitsToDecimal(economics.preAiUpperBound);
    } catch {
      document.querySelector("#studio-upper-bound").textContent = "—";
    }
    invalidatePreparedPackage();
  };

  faceInput.addEventListener("input", renderStudioMath);
  requestInput.addEventListener("input", renderStudioMath);
  for (const input of [supplierInput, payerInput, dueInput, nonceInput, documentHashInput, targetInput]) {
    input.addEventListener("input", invalidatePreparedPackage);
  }
  targetInput.addEventListener("input", renderTargetLabels);
  documentInput.addEventListener("change", invalidatePreparedPackage);
  consentInput.addEventListener("change", invalidatePreparedPackage);

  dealForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const preparationRevision = studioOperationGuard.begin();
    dealForm.setAttribute("aria-busy", "true");
    reviewForm?.setAttribute("aria-busy", "false");
    errorOutput.textContent = "";
    clearCreditMemo();
    preparedPackage = null;
    downloadPackage.disabled = true;

    try {
      if (!consentInput.checked) throw new Error("Confirm that the invoice preparation is synthetic or authorized.");

      const selectedFile = documentInput.files?.[0];
      const suppliedHash = documentHashInput.value.trim();
      if (selectedFile && suppliedHash) throw new Error("Choose a local document or provide an existing hash, not both.");
      if (!selectedFile && !suppliedHash) throw new Error("Select a document or provide a valid 32-byte SHA-256 commitment.");
      if (selectedFile && selectedFile.size > 25 * 1024 * 1024) throw new Error("Local document hashing is limited to 25 MiB.");
      const documentHash = selectedFile ? await sha256(await selectedFile.arrayBuffer()) : suppliedHash.toLowerCase();

      const candidatePackage = await buildUnsignedDealPackage({
        supplier: supplierInput.value.trim(),
        payer: payerInput.value.trim(),
        faceValue: faceInput.value,
        requestedAdvance: requestInput.value,
        dueDate: dueInput.value,
        nonce: nonceInput.value,
        documentHash,
        target: targetInput.value === "testnet" ? OPENBELL_TESTNET_TARGET : OPENBELL_MAINNET
      });
      if (!studioOperationGuard.isCurrent(preparationRevision)) return;
      preparedPackage = candidatePackage;

      packageInvoiceId.textContent = preparedPackage.invoiceTerms.invoiceId;
      packageDocumentHash.textContent = documentHash;
      packageState.textContent = "PREPARED";
      downloadPackage.disabled = false;
      document.querySelector('[data-readiness="terms"]').dataset.complete = "true";
      document.querySelector('[data-readiness="document"]').dataset.complete = "true";
      renderCreditMemo(preparedPackage);
    } catch (error) {
      if (!studioOperationGuard.isCurrent(preparationRevision)) return;
      errorOutput.textContent = error instanceof Error ? error.message : "Unable to prepare the deal package.";
      packageState.textContent = "DRAFT";
    } finally {
      if (studioOperationGuard.isCurrent(preparationRevision)) dealForm.setAttribute("aria-busy", "false");
    }
  });

  downloadPackage.addEventListener("click", () => {
    if (!preparedPackage) return;
    const blob = new Blob([`${JSON.stringify(preparedPackage, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `openbell-deal-${preparedPackage.invoiceTerms.invoiceId.slice(2, 14)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  renderTargetLabels();
  renderStudioMath();
}

const renderCreditMemo = (dealPackage) => {
  if (!creditMemo || !reviewEmpty) return;
  const terms = dealPackage.invoiceTerms;
  const request = dealPackage.underwritingRequest;
  const symbol = dealPackage.target.settlementTokenSymbol;
  setText("#memo-id", compact(terms.invoiceId));
  setText("#memo-face", `${baseUnitsToDecimal(BigInt(terms.faceValue))} ${symbol}`);
  setText("#memo-request", `${baseUnitsToDecimal(BigInt(request.requestedAdvance))} ${symbol}`);
  setText("#memo-max", `${baseUnitsToDecimal(BigInt(request.immutableMaximumAdvance))} ${symbol}`);
  setText("#memo-bound", `${baseUnitsToDecimal(BigInt(request.preAiUpperBound))} ${symbol}`);
  setText("#memo-supplier", terms.supplier);
  setText("#memo-payer", terms.payer);
  setText("#memo-due", new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Number(terms.dueDate) * 1000)));
  setText("#memo-document", terms.documentHash);
  reviewEmpty.hidden = true;
  creditMemo.hidden = false;
  creditMemo.focus({ preventScroll: false });
};

if (reviewForm) {
  const reviewFile = document.querySelector("#review-file");
  const reviewError = document.querySelector("#review-error");
  reviewFile.addEventListener("change", () => {
    studioOperationGuard.invalidate();
    dealForm?.setAttribute("aria-busy", "false");
    reviewForm.setAttribute("aria-busy", "false");
    reviewFile.setAttribute("aria-invalid", "false");
    reviewError.textContent = "";
    clearCreditMemo();
  });
  reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reviewRevision = studioOperationGuard.begin();
    dealForm?.setAttribute("aria-busy", "false");
    reviewForm.setAttribute("aria-busy", "true");
    reviewError.textContent = "";
    reviewFile.setAttribute("aria-invalid", "false");
    clearCreditMemo();
    try {
      const file = reviewFile.files?.[0];
      if (!file) throw new Error("Select an OpenBell JSON package to review.");
      if (file.size > 256 * 1024) throw new Error("Deal-package review is limited to 256 KiB.");
      let candidate;
      try {
        candidate = JSON.parse(await file.text());
      } catch {
        throw new Error("The selected file is not valid JSON.");
      }
      const validated = await validateUnsignedDealPackage(candidate);
      if (!studioOperationGuard.isCurrent(reviewRevision)) return;
      renderCreditMemo(validated);
    } catch (error) {
      if (!studioOperationGuard.isCurrent(reviewRevision)) return;
      reviewFile.setAttribute("aria-invalid", "true");
      reviewError.textContent = error instanceof Error ? error.message : "Unable to review the deal package.";
    } finally {
      if (studioOperationGuard.isCurrent(reviewRevision)) reviewForm.setAttribute("aria-busy", "false");
    }
  });
}

const approvalDigest = document.querySelector("#approval-digest");
const rejectionDigest = document.querySelector("#rejection-digest");
if (approvalDigest && rejectionDigest) {
  Promise.all([
    fetch("/data/openbell-receivables-fixture.json", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`local proof returned HTTP ${response.status}`);
      return response.json();
    }),
    fetch("/data/openbell-xlayer-testnet-lifecycle.json", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`network proof returned HTTP ${response.status}`);
      return response.json();
    })
  ]).then(([proof, network]) => {
    if (
      proof.schemaVersion !== "openbell-receivables-local-fixture-v1" ||
      proof.disclosures?.networkTransaction !== false ||
      proof.disclosures?.realValue !== false ||
      proof.disclosures?.liveModel !== false ||
      proof.disclosures?.independentlyVerified !== false ||
      proof.chain?.client !== "self-spawned Anvil" ||
      proof.chain?.explorerReceipts !== false ||
      proof.approvedJourney?.fundedAdvance !== "70000000" ||
      proof.approvedJourney?.repayment !== "73500000" ||
      proof.rejectedJourney?.finalStatus !== "REJECTED" ||
      network.label !== "XLAYER TESTNET FIXTURE — NO REAL VALUE" ||
      network.verifiedOutcome?.funded !== "75000000" ||
      network.verifiedOutcome?.repaid !== "75750000" ||
      network.verifiedOutcome?.approvedInvoiceStatus !== "SETTLED"
    ) throw new Error("proof boundary or economics changed");
    approvalDigest.textContent = `Local approval digest · ${compact(proof.approvedJourney.approvalDigest)}`;
    rejectionDigest.textContent = `Local rejection digest · ${compact(proof.rejectedJourney.rejectionDigest)}`;
    document.body.dataset.proofReady = "true";
  }).catch(() => {
    approvalDigest.textContent = "Local archive unavailable";
    rejectionDigest.textContent = "Proof boundary failed closed";
    document.body.dataset.proofReady = "false";
  });
}
