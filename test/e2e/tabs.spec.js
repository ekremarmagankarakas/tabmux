// prefix x / n / p / Tab / ; / 1-9 — tab close, cycle, last-tab, and jump.
import { test, expect } from "./fixtures.js";
import { activeUrl, closeInitialBlankTab } from "./helpers.js";

test("x closes the current tab", async ({ context, baseUrl }) => {
  const page = await context.newPage();
  await page.goto(baseUrl);
  const before = context.pages().length;

  await page.bringToFront();
  await page.keyboard.press("Control+b");
  await page.keyboard.press("x");

  await expect.poll(() => context.pages().length).toBe(before - 1);
  expect(page.isClosed()).toBe(true);
});

test("n / p cycle to the next / previous tab and wrap", async ({ context, baseUrl, serviceWorker }) => {
  const urls = ["a", "b", "c"].map((s) => `${baseUrl}?${s}`);
  const pages = [];
  for (const url of urls) {
    const p = await context.newPage();
    await p.goto(url);
    pages.push(p);
  }
  // otherwise "wrap forward past the last tab" would land on the browser's
  // own pre-existing blank tab instead of urls[0]
  await closeInitialBlankTab(serviceWorker);

  // pages[2] ("c") is active — n should wrap forward to "a"
  await pages[2].bringToFront();
  await pages[2].keyboard.press("Control+b");
  await pages[2].keyboard.press("n");
  await expect.poll(() => activeUrl(serviceWorker)).toBe(urls[0]);

  // from "a", p should wrap backward to "c" — issued from the tab that's now
  // actually active, since cycleTab reads chrome's own active tab, not
  // whichever page happens to send the message
  await pages[0].bringToFront();
  await pages[0].keyboard.press("Control+b");
  await pages[0].keyboard.press("p");
  await expect.poll(() => activeUrl(serviceWorker)).toBe(urls[2]);
});

test("digit keys jump straight to a tab by position", async ({ context, baseUrl, serviceWorker }) => {
  const urls = ["1", "2", "3"].map((s) => `${baseUrl}?${s}`);
  let last;
  for (const url of urls) {
    last = await context.newPage();
    await last.goto(url);
  }
  await closeInitialBlankTab(serviceWorker); // so position 1 really is urls[0]

  await last.bringToFront();
  await last.keyboard.press("Control+b");
  await last.keyboard.press("2");

  await expect.poll(() => activeUrl(serviceWorker)).toBe(urls[1]);
});

test("prefix Tab returns to the previously active tab", async ({ context, baseUrl, serviceWorker }) => {
  const a = await context.newPage();
  await a.goto(`${baseUrl}?a`);
  const b = await context.newPage();
  await b.goto(`${baseUrl}?b`); // b ends up active, having been opened last

  // last-tab is driven by the background's own chrome.tabs.onActivated
  // bookkeeping, which lands slightly after Chrome's own tab-activation
  // state does — wait for that to settle before acting, or the "previous"
  // tab it remembers can still be whatever was active before "a" too.
  await expect.poll(() => activeUrl(serviceWorker)).toBe(`${baseUrl}?b`);

  await b.bringToFront();
  await b.keyboard.press("Control+b");
  await b.keyboard.press("Tab");

  await expect.poll(() => activeUrl(serviceWorker)).toBe(`${baseUrl}?a`);
});

test("prefix ; is the same last-tab command as Tab", async ({ context, baseUrl, serviceWorker }) => {
  const a = await context.newPage();
  await a.goto(`${baseUrl}?a`);
  const b = await context.newPage();
  await b.goto(`${baseUrl}?b`);

  await expect.poll(() => activeUrl(serviceWorker)).toBe(`${baseUrl}?b`);

  await b.bringToFront();
  await b.keyboard.press("Control+b");
  await b.keyboard.press(";");

  await expect.poll(() => activeUrl(serviceWorker)).toBe(`${baseUrl}?a`);
});
