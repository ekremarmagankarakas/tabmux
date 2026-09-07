// prefix N / s / d, and the : command prompt's session/group verbs.
import { test, expect } from "./fixtures.js";
import { sessionsStorage, windowCount, tabByUrl, openWindow, openTab } from "./helpers.js";

// tabmux's own <input> overlay doesn't special-case select-all, so it falls
// to the browser/OS default — which on macOS is Control+A = "move to start
// of line", not "select all" (that's Cmd+A there). Locator.fill() sidesteps
// the whole question by setting the value directly.
async function replacePromptValue(page, value) {
  await page.locator("input").fill(value);
}

test("N replaces the window with a fresh session, autosaved immediately", async ({ context, baseUrl, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await page.bringToFront();
  await page.keyboard.press("Control+b");
  await page.keyboard.press("N");
  await page.keyboard.type("work-e2e");
  await page.keyboard.press("Enter");

  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("work-e2e");
  expect(await windowCount(serviceWorker)).toBe(1); // replaced in place, not a second window
});

test("s opens the session picker; Enter restores the selected session's tabs", async ({ context, baseUrl, serviceWorker }) => {
  const anchor = await context.newPage();
  await anchor.goto(baseUrl); // keeps the browser alive throughout

  const source = await openWindow(context, serviceWorker, `${baseUrl}?a`);
  const source2 = await openTab(context, source, `${baseUrl}?b`);

  await source2.bringToFront();
  await source2.keyboard.press("Control+b");
  await source2.keyboard.press(":");
  await source2.keyboard.type("save picker-test");
  await source2.keyboard.press("Enter");
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("picker-test");

  // detach: closes this popup window so "picker-test" is on disk but not
  // live anywhere — otherwise restoring it elsewhere would just attach/
  // focus this window instead of actually exercising a restore.
  await source2.keyboard.press("Control+b");
  await source2.keyboard.press("d");
  await replacePromptValue(source2, "picker-test");
  await source2.keyboard.press("Enter");
  await expect.poll(() => source2.isClosed()).toBe(true);

  const target = await openWindow(context, serviceWorker, `${baseUrl}?scratch`);
  const { windowId } = await tabByUrl(serviceWorker, `${baseUrl}?scratch`);

  await target.bringToFront();
  await target.keyboard.press("Control+b");
  await target.keyboard.press("s");
  await expect(target.getByText("picker-test")).toBeVisible();
  await target.keyboard.press("Enter");

  await expect.poll(async () => {
    const tabs = await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), windowId);
    return tabs.map((t) => t.url).sort();
  }).toEqual([`${baseUrl}?a`, `${baseUrl}?b`].sort());
});

test("d detaches: saves, then closes just that window", async ({ context, baseUrl, serviceWorker }) => {
  const anchor = await context.newPage();
  await anchor.goto(baseUrl); // keeps the browser alive — detach closes a *whole window*

  const popup = await openWindow(context, serviceWorker, `${baseUrl}?detach-me`);

  await popup.bringToFront();
  await popup.keyboard.press("Control+b");
  await popup.keyboard.press("d");
  await replacePromptValue(popup, "detach-e2e"); // clear the prefilled timestamp default
  await popup.keyboard.press("Enter");

  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("detach-e2e");
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(await windowCount(serviceWorker)).toBe(1); // only the popup's window closed
});

test(": command prompt — new, group, ungroup, save, kill", async ({ context, baseUrl, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.bringToFront();

  const before = context.pages().length;
  await page.keyboard.press("Control+b");
  await page.keyboard.press(":");
  await page.keyboard.type("new");
  await page.keyboard.press("Enter");
  await expect.poll(() => context.pages().length).toBe(before + 1);

  await page.keyboard.press("Control+b");
  await page.keyboard.press(":");
  await page.keyboard.type("group cmd-group");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await tabByUrl(serviceWorker, baseUrl))?.groupId).not.toBe(-1);

  await page.keyboard.press("Control+b");
  await page.keyboard.press(":");
  await page.keyboard.type("ungroup");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await tabByUrl(serviceWorker, baseUrl))?.groupId).toBe(-1);

  await page.keyboard.press("Control+b");
  await page.keyboard.press(":");
  await page.keyboard.type("save kill-test");
  await page.keyboard.press("Enter");
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("kill-test");

  await page.keyboard.press("Control+b");
  await page.keyboard.press(":");
  await page.keyboard.type("kill kill-test");
  await page.keyboard.press("Enter");
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).not.toContain("kill-test");
});

test(": restore <name> (not just the picker) restores a saved session", async ({ context, baseUrl, serviceWorker }) => {
  const anchor = await context.newPage();
  await anchor.goto(baseUrl);

  const source = await openWindow(context, serviceWorker, `${baseUrl}?a`);
  await source.bringToFront();
  await source.keyboard.press("Control+b");
  await source.keyboard.press(":");
  await source.keyboard.type("save colon-restore");
  await source.keyboard.press("Enter");
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("colon-restore");

  // detach so it's on disk but not live anywhere (see the `s` picker test
  // above for why that matters here)
  await source.keyboard.press("Control+b");
  await source.keyboard.press("d");
  await replacePromptValue(source, "colon-restore");
  await source.keyboard.press("Enter");
  await expect.poll(() => source.isClosed()).toBe(true);

  const target = await openWindow(context, serviceWorker, `${baseUrl}?scratch`);
  const { windowId } = await tabByUrl(serviceWorker, `${baseUrl}?scratch`);

  await target.bringToFront();
  await target.keyboard.press("Control+b");
  await target.keyboard.press(":");
  await target.keyboard.type("restore colon-restore");
  await target.keyboard.press("Enter");

  await expect.poll(async () => {
    const tabs = await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), windowId);
    return tabs.map((t) => t.url);
  }).toEqual([`${baseUrl}?a`]);
});
