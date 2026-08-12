import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const forbiddenPaths = /(^|\/)(demo[_-]?script|recording[_-]?script|judge[_-]?script|submission[_-]?checklist)(\.|\/|$)|(^|\/).*SUBMISSION.*\.md$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:privateKey|private_key|mnemonic|seedPhrase|seed_phrase)\b\s*[:=]/i,
  /\b(?:OPENAI_API_KEY|BANKR_API_KEY|OKX_SECRET_KEY|OKX_PASSPHRASE)\b\s*[:=]/,
  /\/Users\/[^/\s]+\/(?:Documents|Downloads|\.config|\.ssh)\//
];

const violations = [];
for (const path of tracked) {
  if (forbiddenPaths.test(path)) violations.push(`forbidden path: ${path}`);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) violations.push(`forbidden content ${pattern}: ${path}`);
  }
}
if (violations.length) throw new Error(violations.join("\n"));
console.log(`public boundary clear across ${tracked.length} tracked paths`);
