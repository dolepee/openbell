import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";

export const forbiddenPathPattern = /(^|\/)(demo[_-]?script|recording[_-]?script|judge[_-]?script|submission[_-]?checklist)(\.|\/|$)|(^|\/).*SUBMISSION.*\.md$/i;

export const forbiddenContentPatterns = [
  { name: "private key PEM", pattern: /-----BEGIN (?:(?:RSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----/ },
  { name: "private key assignment", pattern: /["']?\b(?:[A-Z0-9_]*PRIVATE_KEY|privateKey|private_key)\b["']?\s*[:=]\s*["']?(?:0x)?[0-9a-f]{64}["']?/i },
  { name: "wallet recovery phrase", pattern: /\b(?<!PUBLIC_ANVIL_)(?:mnemonic|seedPhrase|seed_phrase|recoveryPhrase|recovery_phrase)\b\s*[:=]\s*["'](?:[a-z]+\s+){11,23}[a-z]+["']/i },
  { name: "secret assignment", pattern: /["']?\b(?:apiKey|api_key|secretKey|secret_key|clientSecret|client_secret|accessToken|access_token|password|passphrase|credential)\b["']?\s*[:=]\s*["'](?!test(?:-only)?["']|example["']|redacted["']|public["'])[^"'\r\n]{12,}["']/i },
  { name: "credential variable", pattern: /["']?\b[A-Z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSPHRASE)\b["']?\s*[:=]\s*["']?(?!["']?(?:test(?:-only)?|example|redacted|public)["']?(?:\s|$))[^\s"']{8,}/im },
  { name: "RPC credential URL", pattern: /https?:\/\/[^\s/:@]+:[^\s/@]{12,}@[^\s]+/i },
  { name: "tokenized RPC URL", pattern: /["']?\b[A-Z0-9_]*RPC_URL\b["']?\s*[:=]\s*["']?https?:\/\/[^\s"'?#]+(?:\/[^\s"'?#]*[a-z0-9_-]{24,}|[?&][^\s"'=]+=[^\s"'&]{12,})/i },
  { name: "RPC secret assignment", pattern: /["']?\b(?:[A-Z0-9_]*RPC[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD|PASSPHRASE|KEY|AUTH|CREDENTIAL)|rpc(?:Secret|_secret|Token|_token|ApiKey|_api_key|Password|_password|Passphrase|_passphrase|Key|_key|Auth|_auth|Credential|_credential))\b["']?\s*[:=]\s*["']?(?!["']?(?:test(?:-only)?|example|redacted|public)["']?(?:\s|$))[^\s"']{8,}/im },
  { name: "nested JSON RPC credential", pattern: /["']?rpc["']?\s*:\s*\{[^{}]{0,2048}?["']?(?:secret|token|api[_-]?key|password|passphrase|key|auth|credential)["']?\s*:\s*["']?(?!(?:test(?:-only)?|example|redacted|public)["']?(?:\s|[,}]))[^\s"'}][^,}\r\n]*/i },
  { name: "nested YAML RPC credential", pattern: /(?:^|\n)([ \t]*)rpc\s*:\s*(?:\r?\n)\1[ \t]+(?:secret|token|api[_-]?key|password|passphrase|key|auth|credential)\s*:\s*["']?(?!(?:test(?:-only)?|example|redacted|public)["']?\s*$)\S[^\r\n]*/im },
  { name: "raw signed transaction field", pattern: /["']?(?:rawTransaction|raw_transaction|signedTransaction|signed_transaction|serializedTransaction|serialized_transaction)["']?\s*[:=]\s*["']?0x[0-9a-f]{64,}/i },
  { name: "raw signature field", pattern: /["']?(?:signature|rawSignature|raw_signature|sig)["']?\s*[:=]\s*["']?0x[0-9a-f]{130}["']?/i },
  { name: "wallet recovery material", pattern: /\b(?:keystore|walletBackup|wallet_backup|recoveryBundle|recovery_bundle)\b\s*[:=]/i },
  { name: "private operator notes", pattern: /(?:^|\n)\s*(?:#{1,6}\s*)?(?:private operator notes?|internal submission notes?|judge walkthrough|submission talking points?|recording narration)\s*:/im },
  { name: "private user path", pattern: /\/(?:Users|home)\/[^/\s]+\/(?:Documents|Downloads|\.config|\.ssh|\.aws|\.gnupg)\// }
];

const binaryAllowlist = new Map([
  ["web/public/openbell-og.png", new Set([
    "10e56a81d759142afdb6df3f6bc8e4a240955107b91fb1ae2bd46ed1729be4ea",
    "f732d60a9aa67f07aa72c39d232bc6db4f2d83ad923b76208711f533c8e20044",
    "bea86ed3da6b467606096130ab8e1af63f58dc1e53e0af17aa49fb40ee99ee4f",
    "dfee211f4ef2992ce1b2d7c33ed338bfdca596efdd3747c4aea1701b1bea61a4",
    "42c80e17fc32f4d91b416db48ac47c9ae4a7f91dd5d2952b30df6ea84425eb42"
  ])]
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isText = (bytes) => !bytes.subarray(0, 8_192).includes(0);
const placeholderCredential = (value) => {
  const trimmed = value.trim();
  return /^(?:|test(?:-only)?|example|redacted|public|string|number|boolean|unknown|never|undefined|null)$/i.test(trimmed)
    || /^\$\{/.test(trimmed)
    || /^(?:this|options|config|process\.env)(?:\.[A-Za-z_$][\w$]*)+$/.test(trimmed);
};

const normalizedCredentialKey = (rawKey) => rawKey.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[-_]/g, "");
const credentialKinds = (rawKey) => {
  const key = normalizedCredentialKey(rawKey);
  return {
    endpoint: key.includes("rpc") && /(?:secret|token|apikey|password|passphrase|key|auth|credential)$/.test(key),
    generic: /^(?:privatekey|apikey|secret|secretkey|clientsecret|accesstoken|authtoken|password|passphrase|credential)$/.test(key)
  };
};

const scanTypeScriptCredentialInitializers = ({ path, text }) => {
  const violations = [];
  const inspect = (name, value) => {
    const kinds = credentialKinds(name);
    if (kinds.endpoint && !placeholderCredential(value)) violations.push(`forbidden typed endpoint credential: ${path}`);
    if (kinds.generic && !placeholderCredential(value)) violations.push(`forbidden typed credential: ${path}`);
  };
  const scanner = createScanner(true, undefined, text);
  const tokens = [];
  let previousEnd = -1;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (scanner.getTokenEnd() <= previousEnd) {
      if (kind === SyntaxKind.PrivateIdentifier && scanner.getTokenText() === "") kind = scanner.reScanHashToken();
      if (scanner.getTokenEnd() <= previousEnd) throw new Error(`TypeScript scanner stalled: ${path}`);
    }
    tokens.push({ kind, value: scanner.getTokenValue() });
    previousEnd = scanner.getTokenEnd();
  }
  const stringValue = (token) => token && (token.kind === SyntaxKind.StringLiteral || token.kind === SyntaxKind.NoSubstitutionTemplateLiteral) ? token.value : undefined;
  const opens = new Map([[SyntaxKind.OpenParenToken, SyntaxKind.CloseParenToken], [SyntaxKind.OpenBraceToken, SyntaxKind.CloseBraceToken], [SyntaxKind.OpenBracketToken, SyntaxKind.CloseBracketToken], [SyntaxKind.LessThanToken, SyntaxKind.GreaterThanToken]]);
  const closes = new Set(opens.values());
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== SyntaxKind.Identifier && token.kind !== SyntaxKind.PrivateIdentifier) continue;
    const name = token.kind === SyntaxKind.PrivateIdentifier ? token.value.slice(1) : token.value;
    if (!Object.values(credentialKinds(name)).some(Boolean)) continue;
    let cursor = index + 1;
    if (tokens[cursor]?.kind === SyntaxKind.QuestionToken) cursor += 1;
    if (tokens[cursor]?.kind === SyntaxKind.EqualsToken) {
      const value = stringValue(tokens[cursor + 1]);
      if (value !== undefined) inspect(name, value);
      continue;
    }
    if (tokens[cursor]?.kind !== SyntaxKind.ColonToken) continue;
    const stack = [];
    for (cursor += 1; cursor < tokens.length; cursor += 1) {
      const current = tokens[cursor];
      if (opens.has(current.kind)) {
        stack.push(opens.get(current.kind));
        continue;
      }
      if (closes.has(current.kind)) {
        if (stack.at(-1) === current.kind) stack.pop();
        else if (stack.length === 0) break;
        continue;
      }
      if (stack.length !== 0) continue;
      if (current.kind === SyntaxKind.CommaToken || current.kind === SyntaxKind.SemicolonToken) break;
      if (current.kind === SyntaxKind.EqualsToken) {
        const value = stringValue(tokens[cursor + 1]);
        if (value !== undefined) inspect(name, value);
        break;
      }
    }
  }
  return violations;
};

const scanStructuredCredentialAssignments = ({ path, text }) => {
  const violations = [];
  const inspect = (rawKey, value) => {
    const kinds = credentialKinds(rawKey);
    if (kinds.endpoint && !placeholderCredential(value)) violations.push(`forbidden structured endpoint credential: ${path}`);
    if (kinds.generic && !placeholderCredential(value)) violations.push(`forbidden structured credential: ${path}`);
  };
  const assignment = /(?=["']?\b([A-Za-z_][A-Za-z0-9_-]*)\b["']?\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,};\r\n]+)))/gm;
  for (const match of text.matchAll(assignment)) {
    inspect(match[1], match[2] ?? match[3] ?? match[4] ?? "");
  }
  return violations;
};

export const scanPublicText = ({ path, text }) => {
  const violations = [];
  if (forbiddenPathPattern.test(path)) violations.push(`forbidden path: ${path}`);
  for (const { name, pattern } of forbiddenContentPatterns) {
    if (pattern.test(text)) violations.push(`forbidden ${name}: ${path}`);
  }
  if (/\.(?:[cm]?[jt]sx?)$/i.test(path)) violations.push(...scanTypeScriptCredentialInitializers({ path, text }));
  violations.push(...scanStructuredCredentialAssignments({ path, text }));
  for (const match of text.matchAll(/https?:\/\/[^\s"'`<>${}]+/gi)) {
    try {
      const url = new URL(match[0]);
      const knownPublicNegativeFixture = match[0] === ["https://user", "secret@example.com"].join(":") && /testnet-receivables-lifecycle-verifier\.test\.mjs$/.test(path);
      if ((url.username || url.password) && !knownPublicNegativeFixture) violations.push(`forbidden credentialed URL: ${path}`);
      const sensitiveKey = [...url.searchParams.keys()].some((key) => /(?:key|token|secret|auth|credential)/i.test(key));
      const sensitiveValue = [...url.searchParams.values()].some((value) => value.length >= 12 && /[0-9]/.test(value));
      const pathToken = url.pathname.split("/").some((segment) => segment.length >= 24 && /^[0-9a-f_-]+$/i.test(segment));
      if (sensitiveKey || sensitiveValue || pathToken) violations.push(`forbidden tokenized URL: ${path}`);
    } catch {
      violations.push(`malformed URL: ${path}`);
    }
  }
  return violations;
};

export const scanCurrentEvidenceShape = ({ path, text }) => {
  if (!/(?:mainnet-lifecycle|independent-cold-funder)-observations\.json$/i.test(path)) return [];
  return /"input"\s*:/.test(text) ? [`forbidden raw calldata in sanitized observations: ${path}`] : [];
};

const git = (args, options = {}) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });

export const runPublicBoundaryScan = () => {
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const violations = [];
  for (const path of tracked) {
    const stat = lstatSync(path);
    if (stat.isDirectory()) continue;
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      violations.push(`unsupported tracked filesystem entry: ${path}`);
      continue;
    }
    const bytes = readFileSync(path);
    if (!isText(bytes)) {
      const expected = binaryAllowlist.get(path);
      if (!expected?.has(sha256(bytes))) violations.push(`unvalidated binary asset: ${path}`);
      continue;
    }
    const text = bytes.toString("utf8");
    violations.push(...scanPublicText({ path, text }));
    violations.push(...scanCurrentEvidenceShape({ path, text }));
  }

  const objects = git(["rev-list", "--objects", "--all"]).trim().split("\n").filter(Boolean);
  let historicalTextBlobs = 0;
  for (const row of objects) {
    const [objectId, ...pathParts] = row.split(" ");
    const path = pathParts.join(" ") || `<git-object:${objectId}>`;
    if (forbiddenPathPattern.test(path)) violations.push(`forbidden historical path: ${path}`);
    const type = git(["cat-file", "-t", objectId]).trim();
    if (type !== "blob") continue;
    const size = Number(git(["cat-file", "-s", objectId]).trim());
    if (!Number.isSafeInteger(size) || size > 1_048_576) {
      const expected = binaryAllowlist.get(path);
      if (!expected) {
        violations.push(`unvalidated historical large blob: ${path}`);
      } else {
        const bytes = execFileSync("git", ["cat-file", "blob", objectId], { maxBuffer: Math.max(size + 1_024, 2 * 1024 * 1024) });
        if (!expected.has(sha256(bytes))) violations.push(`unvalidated historical large blob hash: ${path}`);
      }
      continue;
    }
    const bytes = execFileSync("git", ["cat-file", "blob", objectId], { maxBuffer: 2 * 1024 * 1024 });
    if (!isText(bytes)) {
      const expected = binaryAllowlist.get(path);
      if (!expected?.has(sha256(bytes))) violations.push(`unvalidated historical binary: ${path}`);
      continue;
    }
    historicalTextBlobs += 1;
    violations.push(...scanPublicText({ path: `${objectId}:${path}`, text: bytes.toString("utf8") }));
  }

  if (violations.length) throw new Error([...new Set(violations)].join("\n"));
  console.log(`public boundary clear across ${tracked.length} tracked paths and ${historicalTextBlobs} reachable text blobs`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runPublicBoundaryScan();
