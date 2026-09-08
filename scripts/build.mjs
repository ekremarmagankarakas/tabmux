// Bundles src/background and src/content (each a real ES module tree) into the
// single flat classic-script files Chrome actually loads, and copies the static
// files (manifest, options page) alongside them. Output goes to dist/ — that's
// the folder to point "Load unpacked" at, never the repo root.
import * as esbuild from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const watch = process.argv.includes("--watch");

const entryPoints = [
  { in: path.join(SRC, "background", "index.js"), out: "background" },
  { in: path.join(SRC, "content", "main.js"), out: "content" },
  { in: path.join(SRC, "options", "options.js"), out: "options" },
  { in: path.join(SRC, "popup", "popup.js"), out: "popup" }
];

const buildOptions = {
  entryPoints,
  bundle: true,
  format: "iife", // fully self-contained — no import/export left for Chrome to resolve
  target: "chrome116",
  outdir: DIST,
  logLevel: "info"
};

async function copyStatic() {
  await fs.mkdir(DIST, { recursive: true });
  await fs.copyFile(path.join(SRC, "manifest.json"), path.join(DIST, "manifest.json"));
  await fs.copyFile(path.join(SRC, "options", "options.html"), path.join(DIST, "options.html"));

  await fs.copyFile(path.join(SRC, "popup", "popup.html"), path.join(DIST, "popup.html"));

  const iconsOut = path.join(DIST, "icons");
  await fs.mkdir(iconsOut, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const name = `icon${size}.png`;
    await fs.copyFile(path.join(SRC, "icons", name), path.join(iconsOut, name));
  }
}

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await copyStatic();

  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("watching src/ for changes — reload the extension in chrome://extensions after each rebuild");
  } else {
    await esbuild.build(buildOptions);
    console.log("built to dist/ — load that folder as an unpacked extension");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
