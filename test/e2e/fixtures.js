// Standard Playwright pattern for testing a Manifest V3 extension: launch a
// persistent context with the built dist/ folder loaded, then read the
// extension id off its service worker. Requires `npm run build` to have run
// first — dist/ is the actual package here, same as loading it by hand via
// "Load unpacked".
import { test as base, chromium } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../../dist");

// A tiny local page (and a "tall" variant, for copy-mode scroll tests) so
// tests don't depend on outbound network access. Query strings/paths are
// used by tests to tell tabs apart when checking chrome.tabs state.
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      if (req.url.startsWith("/tall")) {
        res.end(
          "<!doctype html><title>tall fixture</title>" +
          "<body style='margin:0'><div style='height:6000px'></div>" +
          "<div id='needle'>the-needle</div></body>"
        );
      } else {
        res.end("<!doctype html><title>tabmux e2e fixture</title><body>hello</body>");
      }
    });
    server.listen(0, () => resolve(server));
  });
}

export const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    // Under --load-extension + a persistent context, the MV3 service worker
    // starting doesn't mean its chrome.tabs.*/chrome.tabGroups.* listeners
    // are immediately live in Chrome's event-dispatch system: verified by
    // directly inspecting background/tabs.js's internal state, tab
    // activations that happen right after launch can be silently missed
    // even though the exact same listener reliably catches later ones. A
    // real user never hits this (nobody opens two tabs within the first
    // instant of installing an extension) — it's an automation-launch
    // artifact, not a product bug — but tests that depend on event-driven
    // background state need Chrome's dispatch to have actually settled first.
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await use(worker.url().split("/")[2]);
  },

  // Direct access to the background service worker's JS context — lets tests
  // call the real chrome.tabs/chrome.tabGroups/chrome.storage APIs to set up
  // scenarios and assert on ground truth, instead of only being able to
  // observe whatever tabmux's own UI happens to render.
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await use(worker);
  },

  // One static file server per worker (stateless, safe to share across
  // tests) instead of spinning one up per test.
  baseUrl: [async ({}, use) => {
    const server = await startServer();
    await use(`http://localhost:${server.address().port}/`);
    await new Promise((resolve) => server.close(resolve));
  }, { scope: "worker" }],
});

export const expect = test.expect;
