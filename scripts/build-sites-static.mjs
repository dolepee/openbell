import { cp, mkdir, rm, writeFile } from "node:fs/promises";
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

for (const path of ["index.html", "app.js", "styles.css", "data", "public", "workspace", "proof", "architecture"]) {
  await cp(resolve(webRoot, path), resolve(clientRoot, path), { recursive: true });
}

await writeFile(
  resolve(clientRoot, "_headers"),
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`,
);

await writeFile(
  resolve(serverRoot, "index.js"),
  `export default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    if (url.pathname === "/") url.pathname = "/index.html";\n    else if (url.pathname.endsWith("/")) url.pathname += "index.html";\n    else if (!url.pathname.split("/").at(-1).includes(".")) url.pathname += "/index.html";\n    return env.ASSETS.fetch(new Request(url, request));\n  },\n};\n`,
);

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
