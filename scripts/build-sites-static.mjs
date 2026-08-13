import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(repositoryRoot, "web");
const distRoot = resolve(repositoryRoot, "dist");
const clientRoot = resolve(distRoot, "client");
const serverRoot = resolve(distRoot, "server");

await rm(distRoot, { recursive: true, force: true });
await mkdir(clientRoot, { recursive: true });
await mkdir(serverRoot, { recursive: true });

for (const path of ["index.html", "app.js", "deal-package.mjs", "styles.css", "data", "public", "studio", "operate", "workspace", "proof", "architecture"]) {
  await cp(resolve(webRoot, path), resolve(clientRoot, path), { recursive: true });
}

await writeFile(
  resolve(clientRoot, "_headers"),
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`,
);

await build({
  entryPoints: [resolve(repositoryRoot, "server/index.ts")],
  outfile: resolve(serverRoot, "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none"
});

await writeFile(
  resolve(serverRoot, "wrangler.json"),
  `${JSON.stringify(
    {
      name: "openbell-receivables",
      main: "index.js",
      compatibility_date: "2026-08-12",
      compatibility_flags: ["nodejs_compat"],
      no_bundle: true,
      assets: { directory: "../client" },
      observability: { enabled: true },
    },
    null,
    2,
  )}\n`,
);
