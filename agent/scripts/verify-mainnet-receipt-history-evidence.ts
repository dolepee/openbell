import { readFile } from "node:fs/promises";
import { verifyReceiptHistoryEvidenceArtifact } from "../src/mainnet-receipt-history-evidence.js";

const artifact = JSON.parse(await readFile(
  new URL("../../evidence/openbell-receipt-bound-history-observations.json", import.meta.url), "utf8"
));

const snapshot = await verifyReceiptHistoryEvidenceArtifact(artifact);
process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);

