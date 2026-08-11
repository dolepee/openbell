const journeyControl = document.querySelector("#journey-control");
const consoleNext = document.querySelector("#console-next");
const journeyControls = [journeyControl, consoleNext];
const journeyStatus = document.querySelector("#journey-status");
const resultLabel = document.querySelector("#result-label");
const resultValue = document.querySelector("#result-value");
const resultUnit = document.querySelector("#result-unit");
const decisionStamp = document.querySelector("#decision-stamp");
const decisionConsole = document.querySelector(".decision-console");
const journeySteps = [...document.querySelectorAll("[data-journey-step]")];
const approvalDigest = document.querySelector("#approval-digest");
const rejectionDigest = document.querySelector("#rejection-digest");

const journey = [
  {
    label: "INVOICE AUTHORIZED",
    value: "$100.00",
    unit: "supplier + payer signed",
    stamp: "SIGNED",
    status: "Supplier and payer signatures bind one invoice hash and its exact terms."
  },
  {
    label: "RECORDED AI TERMS",
    value: "$70.00",
    unit: "maximum advance",
    stamp: "AI CAP",
    status: "The contract allowed 80. The recorded model tightened the maximum advance to 70."
  },
  {
    label: "EXACT ADVANCE",
    value: "+$70.00",
    unit: "fixture USDG to supplier",
    stamp: "FUNDED",
    status: "The funder sent exactly 70 fixture USDG and the supplier received exactly 70."
  },
  {
    label: "PAYER SETTLEMENT",
    value: "$73.50",
    unit: "returned to funder",
    stamp: "SETTLED",
    status: "The payer settled exactly 73.50 and the invoice reached its terminal SETTLED state."
  }
];

let currentStep = 0;

const renderStep = () => {
  const state = journey[currentStep];
  resultLabel.textContent = state.label;
  resultValue.textContent = state.value;
  resultUnit.textContent = state.unit;
  decisionStamp.textContent = state.stamp;
  journeyStatus.textContent = state.status;

  journeySteps.forEach((step, index) => {
    if (index === currentStep) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
    if (index < currentStep) step.dataset.complete = "true";
    else delete step.dataset.complete;
  });

  const nextStep = (currentStep + 1) % journey.length;
  const labels = ["Next: AI terms", "Next: funding", "Next: settlement", "Replay journey"];
  journeyControls.forEach((control) => {
    control.querySelector("span").textContent = labels[currentStep];
    control.setAttribute("aria-label", `${labels[currentStep]}. Current step: ${state.stamp}.`);
    control.dataset.nextStep = String(nextStep);
  });
};

const advanceJourney = (event) => {
  currentStep = Number(event.currentTarget.dataset.nextStep ?? "1");
  renderStep();
  if (event.currentTarget === journeyControl && window.matchMedia("(max-width: 980px)").matches) {
    decisionConsole.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
    decisionConsole.focus({ preventScroll: true });
  }
};

journeyControls.forEach((control) => control.addEventListener("click", advanceJourney));

const loadProof = async () => {
  const response = await fetch("data/openbell-receivables-fixture.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`proof returned HTTP ${response.status}`);
  const proof = await response.json();
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
    proof.approvedJourney?.finalStatus !== "SETTLED" ||
    proof.rejectedJourney?.finalStatus !== "REJECTED" ||
    proof.assertions?.typedDataDigestParityChecked !== true ||
    proof.assertions?.expectedSignersRecovered !== true ||
    proof.assertions?.rejectedPathZeroTokenMovement !== true
  ) {
    throw new Error("proof boundary or economics changed");
  }
  approvalDigest.textContent = proof.approvedJourney.approvalDigest;
  rejectionDigest.textContent = proof.rejectedJourney.rejectionDigest;
  document.body.dataset.proofReady = "true";
};

loadProof().catch(() => {
  approvalDigest.textContent = "Local proof unavailable — run npm run e2e:fixture";
  rejectionDigest.textContent = "Local proof unavailable — run npm run e2e:fixture";
  document.body.dataset.proofReady = "false";
});

renderStep();
