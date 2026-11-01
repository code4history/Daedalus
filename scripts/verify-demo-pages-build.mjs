/**
 * Checks the shape of the GitHub Pages artifact in `dist-demo/` (run after
 * `GITHUB_PAGES=true pnpm run build:demo`, i.e. `pnpm run verify:demo`).
 *
 * - both pages exist (the portal and the demo)
 * - neither page is a redirect stub
 * - bundled modules resolve under `/Daedalus/assets/` (the Pages base), never origin-rooted `/assets/`
 * - no cross-origin isolation is injected (no service worker shim, no COOP/COEP headers)
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";

const root = new URL("../dist-demo/", import.meta.url);
const requiredFiles = ["index.html", "demo/worldfile-fit.html"];

async function readText(path) {
  return readFile(new URL(path, root), "utf8");
}

async function assertFile(path) {
  const info = await stat(new URL(path, root));
  if (!info.isFile()) {
    throw new Error(`${path} is not a file`);
  }
  return info;
}

async function listFiles(dirUrl = root) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
    if (entry.isDirectory()) {
      files.push(...await listFiles(url));
    } else {
      files.push(relative(root.pathname, url.pathname));
    }
  }
  return files;
}

for (const file of requiredFiles) {
  await assertFile(file);
}

const portalHtml = await readText("index.html");
const demoHtml = await readText("demo/worldfile-fit.html");
if (/http-equiv=["']refresh/i.test(portalHtml) || /http-equiv=["']refresh/i.test(demoHtml)) {
  throw new Error("demo pages must not be redirect stubs");
}
if (!portalHtml.includes("/Daedalus/assets/") || !demoHtml.includes("/Daedalus/assets/")) {
  throw new Error("built HTML does not resolve bundled modules under /Daedalus/assets/");
}

const textFiles = (await listFiles()).filter((file) => /\.(?:html|js|mjs|css)$/.test(file));
for (const file of textFiles) {
  const text = await readText(file);
  if (text.includes("coi-serviceworker")) {
    throw new Error(`${file} references coi-serviceworker`);
  }
  if (text.includes("Cross-Origin-Opener-Policy") || text.includes("Cross-Origin-Embedder-Policy")) {
    throw new Error(`${file} injects COOP/COEP headers`);
  }
  if (/["'`](?:\/assets\/)/.test(text)) {
    throw new Error(`${file} contains an origin-rooted /assets/ URL`);
  }
}

console.log("dist-demo Pages artifact verified.");
