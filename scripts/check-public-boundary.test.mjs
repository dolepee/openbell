import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanPublicText } from "./check-public-boundary.mjs";

const prohibited = [
  ["secret assignment", `private${"Key"}: "0x${"de".repeat(32)}"`],
  ["prefixed private key", `OPENBELL_${"PRIVATE_KEY"}=0x${"de".repeat(32)}`],
  ["unprefixed private key", `DEPLOYER_${"PRIVATE_KEY"}=${"de".repeat(32)}`],
  ["quoted JSON private key", JSON.stringify({ [`OPENBELL_${"PRIVATE_KEY"}`]: "de".repeat(32) })],
  ["known API credential", `OPENAI_${"API_KEY"}=sk-secret`],
  ["generic API credential", `api_${"key"}: "secret-value-long"`],
  ["quoted JSON generic credential", JSON.stringify({ [`api${"Key"}`]: "super-secret-credential-123456" })],
  ["unquoted generic password", `pass${"word"}=hunter2`],
  ["short JSON generic credential", JSON.stringify({ [`pass${"phrase"}`]: "x y" })],
  ["declared generic password", `const pass${"word"} = "hunter2"`],
  ["exported generic password", `export pass${"word"}=hunter2`],
  ["provider API credential", `ALCHEMY_${"API_KEY"}=super-secret-credential-123456`],
  ["quoted JSON provider credential", JSON.stringify({ [`ALCHEMY_${"API_KEY"}`]: "super-secret-credential-123456" })],
  ["RPC credential URL", Buffer.from("aHR0cHM6Ly91c2VyOnBhc3N3b3JkLWxvbmdAcnBjLmV4YW1wbGU=", "base64").toString("utf8")],
  ["RPC secret", `rpc_${"token"}: "secret-value-long"`],
  ["unquoted RPC token", `RPC_${"TOKEN"}=super-secret-credential-123456`],
  ["unquoted camel RPC token", `rpc${"Token"}=super-secret-credential-123456`],
  ["prefixed unquoted RPC secret", `XLAYER_RPC_${"SECRET"}=super-secret-credential-123456`],
  ["prefixed RPC password", `XLAYER_RPC_${"PASSWORD"}=super-secret-credential-123456`],
  ["quoted JSON prefixed RPC password", JSON.stringify({ [`XLAYER_RPC_${"PASSWORD"}`]: "super-secret-credential-123456" })],
  ["prefixed RPC key", `PROVIDER_RPC_${"KEY"}=super-secret-credential-123456`],
  ["prefixed RPC auth", `PROVIDER_RPC_${"AUTH"}=super-secret-credential-123456`],
  ["short RPC password", `RPC_${"PASSWORD"}=hunter2`],
  ["whitespace RPC passphrase", JSON.stringify({ [`rpc${"Passphrase"}`]: "word word word word" })],
  ["hyphenated JSON RPC token", JSON.stringify({ [`xlayer-rpc-${"token"}`]: "super-secret-credential-123456" })],
  ["nested JSON RPC password", JSON.stringify({ rpc: { [`pass${"word"}`]: "x" } })],
  ["nested YAML RPC password", `rpc:\n  pass${"word"}: hunter2`],
  ["quoted JSON RPC token", JSON.stringify({ [`rpc${"Token"}`]: "super-secret-credential-123456" })],
  ["quoted JSON RPC secret", JSON.stringify({ [`rpc_${"secret"}`]: "super-secret-credential-123456" })],
  ["RPC path token", Buffer.from("WExBWUVSX01BSU5ORVRfUlBDX1VSTD1odHRwczovL3JwYy5leGFtcGxlL3YyLzAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVm", "base64").toString("utf8")],
  ["RPC nonhex path token", Buffer.from("WExBWUVSX01BSU5ORVRfUlBDX1VSTD1odHRwczovL3JwYy5leGFtcGxlL3YyL3NrX2xpdmVfWllYV1ZVVFNSUVBPTk1MS0pJSEc=", "base64").toString("utf8")],
  ["RPC query token", Buffer.from("WExBWUVSX01BSU5ORVRfUlBDX1VSTD1odHRwczovL3JwYy5leGFtcGxlLz9hcGlfa2V5PTAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVm", "base64").toString("utf8")],
  ["signed transaction", `raw${"Transaction"}: "0x${"ab".repeat(80)}"`],
  ["serialized transaction", `serialized${"Transaction"}: "0x${"ab".repeat(80)}"`],
  ["signature", `${"signa"}ture: "0x${"ab".repeat(65)}"`],
  ["signature alias", `s${"ig"}: "0x${"ab".repeat(65)}"`],
  ["wallet recovery", `recovery${"Bundle"}: ./private.bundle`],
  ["operator notes", `Private operator ${"notes"}: call the judge`],
  ["private path", `/${"Users"}/example/Documents/private.json`],
  ["PEM", Buffer.from("LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t", "base64").toString("utf8")],
  ["encrypted PEM", Buffer.from("LS0tLS1CRUdJTiBFTkNSWVBURUQgUFJJVkFURSBLRVktLS0tLQ==", "base64").toString("utf8")]
];

for (const [name, text] of prohibited) {
  test(`rejects ${name}`, () => assert.notEqual(scanPublicText({ path: "fixture.txt", text }).length, 0));
}

test("accepts explicit negative disclosure fields and public fixture labels", () => {
  const text = JSON.stringify({ privateKeysIncluded: false, signedTransactionsIncluded: false, credentialsIncluded: false, label: "NO REAL VALUE" });
  assert.deepEqual(scanPublicText({ path: "evidence.json", text }), []);
});

test("rejects prohibited private-prep paths", () => {
  assert.notEqual(scanPublicText({ path: "docs/DEMO_SCRIPT.md", text: "public-looking text" }).length, 0);
});

test("rejects prohibited material committed and then deleted from reachable history", () => {
  const directory = mkdtempSync(join(tmpdir(), "openbell-boundary-history-"));
  const scanner = fileURLToPath(new URL("./check-public-boundary.mjs", import.meta.url));
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.name", "Boundary Test");
    git("config", "user.email", "boundary@example.invalid");
    writeFileSync(join(directory, "README.md"), "clean\n");
    git("add", "README.md");
    git("commit", "-qm", "clean");
    writeFileSync(join(directory, "temporary.json"), `${"raw"}Transaction: "0x${"ab".repeat(80)}"\n`);
    git("add", "temporary.json");
    git("commit", "-qm", "temporary artifact");
    unlinkSync(join(directory, "temporary.json"));
    git("add", "-u");
    git("commit", "-qm", "delete artifact");
    assert.throws(
      () => execFileSync(process.execPath, [scanner], { cwd: directory, encoding: "utf8", stdio: "pipe" }),
      /forbidden raw signed transaction field/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
