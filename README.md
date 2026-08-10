# OpenBell

**Turn a verified invoice into USDG today.**

OpenBell is a request-funded receivables protocol on X Layer. A supplier and payer sign one
canonical invoice, an AI underwriter produces bounded advance terms, and a funder advances exact
USDG only when those terms pass deterministic contract limits. The payer later settles the fixed
repayment directly to the funder.

The user outcome is deliberately simple:

```text
signed invoice -> bounded AI decision -> exact USDG advance -> payer settlement
```

## Current status

OpenBell is in pre-alpha development for BuildX AI Season. No deployment or live economic result is
claimed yet. Testnet and mainnet addresses will be published only after their receipts are verified.

The testnet deployment is configured for Paxos's canonical X Layer test USDG at
`0xF0863D7A29a55d0c4263c11bFac754312ff078DF`. The mainnet script is separately configured for
canonical USDG at `0x4ae46a509F6b1D9056937BA4500cb143933D2dc8`. Testnet tokens have no value.

## Why the AI is bounded

The underwriter may tighten an advance, increase the required fee within the disclosed ceiling, or
reject an invoice. It cannot bypass both-party signatures, alter the invoice hash, exceed the hard
advance or fee caps, reuse stale risk data, or fund an invoice twice.

## V1 scope

- Canonical invoice registration signed by both supplier and payer
- Structured AI approval or rejection bound to the invoice digest
- Exact, request-specific USDG funding
- Exact payer settlement to the recorded funder
- Duplicate, replay, stale-data, wrong-party and fee-on-transfer rejection
- Pause of new originations without blocking funded invoice settlement

OpenBell V1 has no pool, token, auction, secondary market, governance, collections engine, partial
funding, partial repayment, or document-storage system. Only a document hash is placed onchain.

## Contracts

The contract is under `contracts/src/OpenBellReceivables.sol`. It uses EIP-712 domain separation,
ERC-1271-compatible signature checks, exact ERC-20 balance-delta accounting, replay protection,
reentrancy protection, immutable risk ceilings, rotatable underwriting authority, and originations-
only pause semantics.

Run locally:

```bash
forge fmt --check
forge build
forge test
```

## Product boundary

OpenBell does not claim to invent invoice financing. Its focus is a narrow X Layer-native flow in
which an inspectable AI decision is cryptographically bound to exact financing terms and the chain
proves funding and settlement without pooled lender accounting.
