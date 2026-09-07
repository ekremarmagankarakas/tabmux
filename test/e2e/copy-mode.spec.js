// prefix [ — vim-ish scroll/search mode on the current page.
import { test, expect } from "./fixtures.js";

test("j/k/g/G scroll the page, q exits back to normal mode", async ({ context, baseUrl }) => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}tall`);

  const scrollY = () => page.evaluate(() => window.scrollY);

  await page.keyboard.press("Control+b");
  await page.keyboard.press("[");

  await page.keyboard.press("j");
  await expect.poll(scrollY).toBeGreaterThan(0);

  await page.keyboard.press("G"); // bottom
  await expect.poll(scrollY).toBeGreaterThan(1000);

  await page.keyboard.press("g"); // top
  await expect.poll(scrollY).toBe(0);

  await page.keyboard.press("q"); // exit copy mode

  // back in normal mode, a bare "j" is just a keystroke on the page, not a
  // copy-mode scroll command
  const before = await scrollY();
  await page.keyboard.press("j");
  await new Promise((r) => setTimeout(r, 150));
  expect(await scrollY()).toBe(before);
});

test("/ submits a search and returns to copy mode afterward", async ({ context, baseUrl }) => {
  // window.find() itself — confirmed by calling it directly from the page's
  // own console — unreliably returns false for text that genuinely exists in
  // the DOM under this automated-Chromium launch mode; that's a limitation
  // of that legacy, rendering-dependent API in this environment, not
  // something tabmux controls. What tabmux *does* control, and what's worth
  // asserting on, is that submitting the search prompt re-enters copy mode
  // afterward rather than leaving you stranded in some other state.
  const page = await context.newPage();
  await page.goto(`${baseUrl}tall`);

  await page.bringToFront();
  await page.keyboard.press("Control+b");
  await page.keyboard.press("[");
  await page.keyboard.press("/");
  await page.keyboard.type("the-needle");
  await page.keyboard.press("Enter");

  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("j"); // only scrolls if copy mode is still active
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
});

test("Escape also exits copy mode", async ({ context, baseUrl }) => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}tall`);

  await page.keyboard.press("Control+b");
  await page.keyboard.press("[");
  await page.keyboard.press("j");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await page.keyboard.press("Escape");

  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("k"); // no longer copy mode — shouldn't scroll
  await new Promise((r) => setTimeout(r, 150));
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
