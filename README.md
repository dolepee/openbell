# OpenBell

**Turn a payer-signed invoice into bounded USDG funding.**

OpenBell is a request-funded receivables protocol on X Layer. A supplier and payer sign one
canonical invoice, a genuine AI underwriter approves bounded terms or refuses, and deterministic
contract limits decide what can move. A disclosed human exception can accept accountability after
a refusal only at stricter limits and without erasing the original model artifact. The payer later
settles the fixed repayment directly to the funder.

**Live app:** [openbell.dolepee.com](https://openbell.dolepee.com/)

**One-wallet funding:** [openbell.dolepee.com/fund](https://openbell.dolepee.com/fund/)

**V2 deal studio:** [openbell.dolepee.com/studio](https://openbell.dolepee.com/studio/)

The user outcome is deliberately simple:

```text
signed invoice -> authoritative AI decision -> bounded execution -> exact USDG settlement
```

The `/fund/` route removes the multi-party handoff from the funder's task. It loads one public,
unexpired, underwriter-signed candidate from durable storage, verifies its signature and registered
mainnet state in the browser, and permits only an exact USDG approval followed by the exact funding
call. The invited funder uses one wallet and no JSON files or CLI.

## V2 deal preparation

OpenBell V2 begins before underwriting. The browser-only deal studio lets a supplier prepare invoice
terms, hash the underlying document locally, see the immutable 80% advance ceiling, and export a
deterministic unsigned package for downstream EIP-712 encoding and review.

The studio never uploads the document, connects a wallet, calls a model, produces signatures,
constructs calldata, authorizes a transaction, or promises financing. Its pre-AI upper bound is
only `min(requested advance, immutable contract maximum)`. Genuine risk assessment may lower that
amount or reject the invoice, and supplier plus payer authority remains mandatory.

## Connected testnet desk

The product includes a connected, no-value X Layer testnet journey at `/operate/`:

- supplier and payer sign the same numeric-chain EIP-712 invoice in a browser handoff;
- the supplier registers the exact invoice after a fresh simulation;
- one supplier-authorized underwriting request is independently checked against both official
  X Layer testnet RPCs before any model call;
- supplier-declared payer performance is rejected; fresh connected assessments use zero imported
  history until historical claims can be independently derived from confirmed receipts;
- the genuine first Bankr-mediated GPT-5.6 Terra response is durably sealed with its request and
  response hashes—there is no recorded fallback or retry;
- the current onchain underwriter signs only the bounded decision digest; and
- funder and payer wallets can review, simulate, and execute only reconstructed, zero-value action
  packages against the labelled fixture contracts.

The service has a durable five-call daily ceiling, exact-request replay, confirmed-block rechecks,
and local reconstruction of cached model/signature results. This route remains
`XLAYER TESTNET FIXTURE — NO REAL VALUE`; it is retained for reproducible testing and is separate
from the canonical-USDG mainnet evidence below.

## Current status

OpenBell is in pre-alpha development for BuildX AI Season. The contract is deployed on X Layer
mainnet and one complete canonical-USDG lifecycle has reached `SETTLED`. An unrelated supplier
signed and registered the invoice through the public browser workflow. The payer and funder were
founder-operated, and the underwriter signature was produced by the disclosed project operator.
This proves the product path and real token movement; it does not independently establish the
offchain invoice's legal validity or market demand.

A second unrelated tester then completed the dedicated one-wallet `/fund/` journey without a file
or CLI. Wallet `0x2Ef353...05244` funded invoice `0x02f989...1508` with exactly `0.005 USDG`
in transaction `0xa9068a...030a`. The chain proves the distinct wallet, exact transfer and
`REGISTERED -> FUNDED` transition; the tester's independence is an offchain attestation.

- Mainnet OpenBell Receivables: [`0xc4Ef249b80a6a034198C226278c51b0a903840dd`](https://www.okx.com/web3/explorer/xlayer/address/0xc4Ef249b80a6a034198C226278c51b0a903840dd)
- Mainnet deployment transaction: [`0x328c80d5c4e5a7a13c3143f1f3c5667f83823c3ebdfbd3ca1d9c07b7f3af413e`](https://www.okx.com/web3/explorer/xlayer/tx/0x328c80d5c4e5a7a13c3143f1f3c5667f83823c3ebdfbd3ca1d9c07b7f3af413e)
- Mainnet deployment block: `67764503`
- Mainnet runtime hash: `0x3aa05fd1a2f966e99324c8c24dc3ee67e2f4c11a4f3c8de0da25fc1f7e8a9798`
- Public deployment evidence: [`evidence/openbell-xlayer-mainnet-deployment.json`](evidence/openbell-xlayer-mainnet-deployment.json)
- Reproducible sanitized verification record: [`evidence/openbell-xlayer-mainnet-verification-record.json`](evidence/openbell-xlayer-mainnet-verification-record.json), SHA-256 `d5b69eb5e453fd691e7d9265ed7ce14ef81b2b19fb9ed1bf50dd4ac80670eec8`
- Sanitized two-provider observations: [`evidence/openbell-xlayer-mainnet-observations.json`](evidence/openbell-xlayer-mainnet-observations.json), SHA-256 `e8e750a45a206664b0e85db3496482232556f4b2d0a23db9073c8f4e71b77dd9`. Each source is bound to a fixed official-endpoint SHA-256 commitment; endpoint provenance is committed, not independently attested.
- Deterministic observation verification: [`evidence/openbell-xlayer-mainnet-observation-verification.json`](evidence/openbell-xlayer-mainnet-observation-verification.json), derived by `node scripts/verify-mainnet-observations.mjs`
- Sanitized mainnet lifecycle observations: [`evidence/openbell-xlayer-mainnet-lifecycle-observations.json`](evidence/openbell-xlayer-mainnet-lifecycle-observations.json), SHA-256 `2f8d95f0ee211a720577ce57afef04f7d7a8af63e017c11cf25eec3981468489`
- Mainnet lifecycle verification: [`evidence/openbell-xlayer-mainnet-lifecycle-verification.json`](evidence/openbell-xlayer-mainnet-lifecycle-verification.json), derived by `node scripts/verify-mainnet-lifecycle.mjs`
- Sanitized independent cold-funder observations: [`evidence/openbell-independent-cold-funder-observations.json`](evidence/openbell-independent-cold-funder-observations.json), SHA-256 `a68a8b7d2727ea4be5bd2dc43cd46fc4281816206866fc41322b11bcfe8bab17`
- Deterministic cold-funder verification: [`evidence/openbell-independent-cold-funder.json`](evidence/openbell-independent-cold-funder.json), derived by `node scripts/verify-cold-funder.mjs`

The zero-value CREATE passed two-provider transaction, receipt, canonical-block, runtime, immutable,
getter, role, policy, typehash and EIP-712-domain checks after more than 12 confirmations. Explorer
source publication and an independent third-party audit remain separate, incomplete claims.
The earlier `0xac31d5ee…f020` value is retained only as a sealed private-source manifest commitment; it is not
described as a public manifest. The sanitized record above is the public, byte-reproducible preimage.

### Canonical-USDG mainnet lifecycle

Invoice `0x97b5a9424799a02e456e73bad442e65545334cad44ee6b24f73c437d35767d88`
had a face value of `0.10 USDG` and requested a `0.05 USDG` advance. The genuine first model
assessment returned `REJECT` and was not retried. A disclosed human escalation bound the original
rejected-artifact hash and authorized stricter terms: `0.025 USDG` advanced and `0.02525 USDG`
repaid.

- Register: [`0x4d33630813698f2bbdee3e6adf386128efa6c7aee9d775edc83c22c0b7667948`](https://www.okx.com/web3/explorer/xlayer/tx/0x4d33630813698f2bbdee3e6adf386128efa6c7aee9d775edc83c22c0b7667948)
- Exact funding allowance: [`0x822b0fa4ddf74c77e9b6beb31d3c0ebe5955568c1f33426a8558ef47e934412f`](https://www.okx.com/web3/explorer/xlayer/tx/0x822b0fa4ddf74c77e9b6beb31d3c0ebe5955568c1f33426a8558ef47e934412f)
- Fund `0.025 USDG`: [`0xf17ef4753d4e89f6b25e62978e3e46600850b7457a7af4383618c0dbc1eab35a`](https://www.okx.com/web3/explorer/xlayer/tx/0xf17ef4753d4e89f6b25e62978e3e46600850b7457a7af4383618c0dbc1eab35a)
- Exact repayment allowance: [`0x8fda8d63338694e5705ce537991d7be410f209b076300ae515006408d77de6fb`](https://www.okx.com/web3/explorer/xlayer/tx/0x8fda8d63338694e5705ce537991d7be410f209b076300ae515006408d77de6fb)
- Settle `0.02525 USDG`: [`0xdd8e682a7cc7342f11e355567ccb8c99e32b926287f85ed111cbfa8d273658e5`](https://www.okx.com/web3/explorer/xlayer/tx/0xdd8e682a7cc7342f11e355567ccb8c99e32b926287f85ed111cbfa8d273658e5)

The public verifier checks both official RPCs, canonical transaction inclusion, committed calldata,
receipt success, final invoice state, historical supplier/funder/payer balance deltas, and zero
remaining token allowances. Raw signature-bearing calldata is excluded; each transaction retains
its fixed hash, selector, byte length, and irreversible calldata commitment. Endpoint provenance is
committed but not independently attested, and the current public evidence contains no raw
signatures, signed transactions, credentials, or wallet secrets.

### No-value testnet fixture

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
verified mainnet deployment and the token used by the completed lifecycle above.

## Why the AI is bounded

The underwriter may tighten an advance, increase the required fee within the disclosed ceiling, or
reject an invoice. It cannot bypass both-party signatures, alter the invoice hash, exceed the hard
advance or fee caps, reuse stale risk data, or fund an invoice twice.

In the mainnet lifecycle, the model refused and emitted no executable approval. The human
escalation did not relabel that output: its signed digest committed to the rejected artifact and
could authorize at most the stricter of 25% of face value and 50% of the original request. The
executed `0.025 USDG` advance reached both limits exactly.

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

Open `http://127.0.0.1:4187` for local development. The published canonical site is
[`https://openbell.dolepee.com/`](https://openbell.dolepee.com/).

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
