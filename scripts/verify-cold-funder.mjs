import { readFile } from "node:fs/promises";
import { verifyColdFunderObservations } from "./lib/cold-funder-verifier.mjs";

const observations = JSON.parse(await readFile(new URL("../evidence/openbell-independent-cold-funder-observations.json", import.meta.url), "utf8"));
process.stdout.write(`${JSON.stringify(verifyColdFunderObservations(observations), null, 2)}\n`);
