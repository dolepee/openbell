import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
await build({
  entryPoints: [resolve(root, "web/src/operate-app.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: resolve(root, "web/operate/app.js"),
  legalComments: "none",
  sourcemap: false,
  minify: true
});

const operateHtml = await readFile(resolve(root, "web/operate/index.html"), "utf8");
const replacements = [
  ["<title>Connected testnet desk — OpenBell</title>", "<title>Live USDG desk — OpenBell</title>"],
  [
    '<meta name="description" content="Validate, simulate and execute one exact OpenBell no-value testnet action with the required wallet." />',
    '<meta name="description" content="Validate, simulate and execute one exact OpenBell action using canonical USDG on X Layer mainnet." />'
  ],
  ['href="https://openbell.dolepee.com/operate/"', 'href="https://openbell.dolepee.com/mainnet/"'],
  ['content="https://openbell.dolepee.com/operate/"', 'content="https://openbell.dolepee.com/mainnet/"'],
  ['content="OpenBell connected testnet desk"', 'content="OpenBell live USDG desk"'],
  [
    'content="A fail-closed wallet workspace for exact, no-value OpenBell actions on X Layer testnet."',
    'content="A bounded receivables journey where AI proposes terms and X Layer enforces the smallest authorized USDG amount."'
  ],
  ['<body data-page="operate" class="operate-page">', '<body data-page="operate" data-network="mainnet" class="operate-page">']
];
let mainnetHtml = operateHtml;
for (const [from, to] of replacements) {
  if (!mainnetHtml.includes(from)) throw new Error(`mainnet entry source drift: ${from}`);
  mainnetHtml = mainnetHtml.replace(from, to);
}
await mkdir(resolve(root, "web/mainnet"), { recursive: true });
await writeFile(resolve(root, "web/mainnet/index.html"), mainnetHtml);
