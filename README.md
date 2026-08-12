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

OpenBell is in pre-alpha development for BuildX AI Season. The contract is deployed and verified
on X Layer mainnet, while the complete economic journey remains a labelled no-value testnet
fixture. No mainnet lifecycle or real-value activity has occurred.

- Mainnet OpenBell Receivables: [`0xc4Ef249b80a6a034198C226278c51b0a903840dd`](https://www.okx.com/web3/explorer/xlayer/address/0xc4Ef249b80a6a034198C226278c51b0a903840dd)
- Mainnet deployment transaction: [`0x328c80d5c4e5a7a13c3143f1f3c5667f83823c3ebdfbd3ca1d9c07b7f3af413e`](https://www.okx.com/web3/explorer/xlayer/tx/0x328c80d5c4e5a7a13c3143f1f3c5667f83823c3ebdfbd3ca1d9c07b7f3af413e)
- Mainnet deployment block: `67764503`
- Mainnet runtime hash: `0x3aa05fd1a2f966e99324c8c24dc3ee67e2f4c11a4f3c8de0da25fc1f7e8a9798`
- Public deployment evidence: [`evidence/openbell-xlayer-mainnet-deployment.json`](evidence/openbell-xlayer-mainnet-deployment.json)

The zero-value CREATE passed two-provider transaction, receipt, canonical-block, runtime, immutable,
getter, role, policy, typehash and EIP-712-domain checks after more than 12 confirmations. Explorer
source publication and an independent third-party audit remain separate, incomplete claims.

The no-value testnet proof remains the only executed lifecycle:

- Fixture tUSDG: [`0x7E7a189a8CE288E9581Ba3CDf14ac3D4a1624703`](https://www.okx.com/web3/explorer/xlayer-test/address/0x7E7a189a8CE288E9581Ba3CDf14ac3D4a1624703)
- OpenBell Receivables: [`0x7eb9C2418ec935d43E6761e462eAA5388BD6ca18`](https://www.okx.com/web3/explorer/xlayer-test/address/0x7eb9C2418ec935d43E6761e462eAA5388BD6ca18)
- Chain: X Layer Testnet `1952`
- Boundary: `XLAYER TESTNET FIXTURE — NO REAL VALUE`

Both zero-value CREATE receipts passed two-provider canonical-block, runtime, getter, role, policy,
typehash and EIP-712-domain checks after more than 12 confirmations. Explorer source publication and
an independent third-party audit remain separate, incomplete claims.

The completed nine-transaction fixture journey (including the two earlier faucet claims) passed
the same two-provider canonical/reorg gate after at least 12 confirmations. It proves a genuine
prior-default decision ending `REJECTED` with zero token movement, followed by a fresh invoice that
funded exactly 75 fixture tUSDG and settled exactly 75.75 fixture tUSDG to final state `SETTLED`.
These are testnet receipts for a labelled no-value asset, not real receivables or canonical USDG.

The first testnet path uses a separately labelled, no-value fixture token so the complete journey is
obtainable without implying canonical-asset availability. A second optional script targets Paxos's
canonical X Layer test USDG at `0xF0863D7A29a55d0c4263c11bFac754312ff078DF`; the current fork test
uses local state allocation and proves contract compatibility, not that an operator wallet can
obtain that token. The mainnet script is separately configured for canonical USDG at
`0x4ae46a509F6b1D9056937BA4500cb143933D2dc8`, which is also the settlement-token binding of the
verified mainnet deployment. No mainnet invoice was registered, funded, settled, rejected, or moved
for value.

## Why the AI is bounded

The underwriter may tighten an advance, increase the required fee within the disclosed ceiling, or
reject an invoice. It cannot bypass both-party signatures, alter the invoice hash, exceed the hard
advance or fee caps, reuse stale risk data, or fund an invoice twice.

The first genuine model evidence is now frozen with zero retries. Bankr-mediated GPT-5.6 Terra
rejected the synthetic prior-default payer. For the stronger payer it proposed an 85% maximum and a
1% fee. The requested advance was only 75%, and the contract's immutable maximum remained 80%, so
the honest deterministic result is:

```text
min(requested 75, model ceiling 85, immutable contract ceiling 80) = 75 funded
75 + 1% = 75.75 due
```

Those genuine responses and hashes are committed in
[`evidence/openbell-bankr-model-evidence.json`](evidence/openbell-bankr-model-evidence.json). They
are real Bankr-mediated model evidence. The corresponding no-value testnet lifecycle has now been
executed and independently refetched through both configured official RPC providers. The older
70/73.5 local journey below remains recorded-model evidence only and is not presented as the live
model result.

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
contract, records one prior-default rejection, then proves an older, separate recorded-model
journey:

```text
100 face value -> 75 requested -> contract allows 80 -> recorded model caps 70
70 fixture USDG funded -> 73.5 settled -> SETTLED
```

The command writes an ignored local manifest under `.openbell/`. Its transaction hashes are local
Anvil receipts—not X Layer explorer proof—and its 70/73.5 decision is an older recorded fixture, not
the genuine live-model result described above.

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
domain through post-deploy assertions. The command itself remains only an offline rehearsal. The
accompanying read-only verifier rebuilds a clean source checkpoint offline, binds exact initcode and
CREATE addresses, and requires 12-confirmation receipts, canonical block rechecks,
source-compatible runtimes, and exact getters. That verifier produced the two testnet addresses
listed above; candidate generation still refuses a dirty worktree.

## Product boundary

OpenBell does not claim to invent invoice financing. Its focus is a narrow X Layer-native flow in
which an inspectable AI decision is cryptographically bound to exact financing terms and the chain
proves funding and settlement without pooled lender accounting.
