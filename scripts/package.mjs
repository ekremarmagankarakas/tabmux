// Builds dist/ fresh, then zips its *contents* (not the dist/ folder itself)
// into tabmux.zip at the repo root — manifest.json needs to sit at the zip's
// top level for the Chrome Web Store dashboard to accept the upload.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ZIP = path.join(ROOT, "tabmux.zip");

execFileSync("node", [path.join(__dirname, "build.mjs")], { stdio: "inherit" });

if (existsSync(ZIP)) rmSync(ZIP);

// -x ".*" skips dotfiles (e.g. a stray .DS_Store) that don't belong in the package.
execFileSync("zip", ["-r", ZIP, ".", "-x", ".*"], { cwd: DIST, stdio: "inherit" });

console.log(`packaged ${path.relative(ROOT, ZIP)} — upload this file's contents (not dist/) to the Chrome Web Store`);
