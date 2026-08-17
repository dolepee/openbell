# Repository review rules

- Keep every network, asset-value, model, and verification claim traceable to committed public evidence.
- Preserve the explicit boundary: the testnet lifecycle is a no-value fixture. Mainnet lifecycle or real-value claims require sanitized observations from both official RPCs plus deterministic fail-closed verification; user independence remains an explicitly labelled offchain attestation.
- Never commit credentials, private keys, raw signatures, signed transactions, wallet recovery material, RPC secrets, or private operator/submission notes.
- Treat wallet actions, signing, broadcasts, spending, role rotation, explorer publication, Git pushes, website publication, and form submission as separately approved actions.
- Run `npm run check` before proposing a merge. Evidence exporters and parity tests must fail closed on economic, disclosure, address, or hash drift.
- Keep the local recorded-model replay distinct from the genuine Bankr-mediated model evidence and the verified network evidence.
- Do not add demo narration, recording scripts, judge walkthroughs, private submission checklists, or form drafts to this repository.
