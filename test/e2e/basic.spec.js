// End-to-end smoke tests: load the real built extension into a real
// Chromium, drive it with actual keyboard input, and assert on actual
// browser state (tabs/pages) — the things a unit test can't reach because
// they depend on Chrome's own extension/tab machinery, not just tabmux's
// own logic.
import { test, expect } from "./fixtures.js";

test("prefix + ? opens the help overlay", async ({ context, baseUrl }) => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await page.keyboard.press("Control+b");
  await page.keyboard.press("?");

  // The overlay lives inside a shadow root, invisible to a plain CSS
  // selector — Playwright's piercing selector engine crosses shadow
  // boundaries for text/role queries automatically.
  await expect(page.getByText("tabmux — keybindings")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("tabmux — keybindings")).toBeHidden();
});

test("prefix + c opens a new tab in the same window", async ({ context, baseUrl }) => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  const before = context.pages().length;
  await page.keyboard.press("Control+b");
  await page.keyboard.press("c");

  await expect.poll(() => context.pages().length).toBe(before + 1);
});

test("options page saves a custom prefix and a fresh tab picks it up", async ({ context, extensionId, baseUrl }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  await options.getByRole("checkbox", { name: "Ctrl" }).uncheck();
  await options.getByRole("checkbox", { name: "Alt" }).check();
  await options.locator("#key").fill("t");
  await options.getByRole("button", { name: "save" }).click();
  await expect(options.locator("#ok")).toHaveClass(/show/);

  const page = await context.newPage();
  await page.goto(baseUrl);

  // The old default prefix should no longer do anything...
  const before = context.pages().length;
  await page.keyboard.press("Control+b");
  await page.keyboard.press("c");
  await new Promise((r) => setTimeout(r, 200));
  expect(context.pages().length).toBe(before);

  // ...but the new one should.
  await page.keyboard.press("Alt+t");
  await page.keyboard.press("c");
  await expect.poll(() => context.pages().length).toBe(before + 1);
});
