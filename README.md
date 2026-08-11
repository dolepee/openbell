# OpenBell

**Turn a payer-signed invoice into bounded USDG funding.**

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

The first testnet path is a separately labelled, no-value fixture token so the complete journey is
obtainable without implying canonical-asset availability. A second optional script targets Paxos's
canonical X Layer test USDG at `0xF0863D7A29a55d0c4263c11bFac754312ff078DF`; the current fork test
uses local state allocation and proves contract compatibility, not that an operator wallet can
obtain that token. The mainnet script is separately configured for canonical USDG at
`0x4ae46a509F6b1D9056937BA4500cb143933D2dc8`. No testnet deployment has occurred.

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
npm run e2e:fixture
```

`npm run e2e:fixture` starts its own chain-ID-1952 Anvil, deploys the labelled fixture token and
contract, records one prior-default rejection, then proves a separate AI-bounded journey:

```text
100 face value -> 75 requested -> contract allows 80 -> recorded model caps 70
70 fixture USDG funded -> 73.5 settled -> SETTLED
```

The command writes an ignored local manifest under `.openbell/`. Its transaction hashes are local
Anvil receipts—not X Layer explorer proof—and the recorded fixture decision is not a live model call.

The product surface is a dependency-free static site generated from that exact manifest:

```bash
npm run web:check
npm run web:serve
```

Open `http://127.0.0.1:4187`. The local page is deliberately `noindex`; canonical and absolute social
URLs are added only when a public host is approved.

The fixture-first deployment script can be rehearsed without an RPC or broadcast:

```bash
OPENBELL_DEPLOYER=0x... \
OPENBELL_OWNER=0x... \
OPENBELL_UNDERWRITER=0x... \
npm run deploy:fixture:testnet:dry-run
```

It requires chain ID 1952, explicit nonzero roles with a distinct owner and underwriter, deploys the
labelled fixture token before OpenBell, and seals the token, protocol configuration, and EIP-712
domain through post-deploy assertions. This is only an offline rehearsal. The accompanying
read-only verifier rebuilds a clean source checkpoint offline, binds exact initcode and CREATE
addresses, and later requires 12-confirmation receipts, canonical block rechecks, source-compatible
runtimes, and exact getters. Candidate generation deliberately refuses a dirty worktree. No address
produced by the dry run is a public deployment.

## Product boundary

OpenBell does not claim to invent invoice financing. Its focus is a narrow X Layer-native flow in
which an inspectable AI decision is cryptographically bound to exact financing terms and the chain
proves funding and settlement without pooled lender accounting.
