import { readFile } from "node:fs/promises";
import { verifyMainnetObservations } from "./lib/mainnet-observation-verifier.mjs";

const observations = JSON.parse(await readFile(new URL("../evidence/openbell-xlayer-mainnet-observations.json", import.meta.url), "utf8"));
const artifact = JSON.parse(await readFile(new URL("../out/OpenBellReceivables.sol/OpenBellReceivables.json", import.meta.url), "utf8"));
process.stdout.write(`${JSON.stringify(verifyMainnetObservations({ observations, artifact }), null, 2)}\n`);
