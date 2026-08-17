import { build } from "esbuild";
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

await build({
  entryPoints: [resolve(root, "web/src/fund-app.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: resolve(root, "web/fund/app.js"),
  legalComments: "none",
  sourcemap: false,
  minify: true
});
