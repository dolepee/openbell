import { readFile } from "node:fs/promises";
import { verifyMainnetLifecycleObservations } from "./lib/mainnet-lifecycle-verifier.mjs";

const observations = JSON.parse(await readFile(new URL("../evidence/openbell-xlayer-mainnet-lifecycle-observations.json", import.meta.url), "utf8"));
process.stdout.write(`${JSON.stringify(verifyMainnetLifecycleObservations(observations), null, 2)}\n`);
