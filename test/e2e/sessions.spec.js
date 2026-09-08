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

test("N opens a fresh session in a new window and minimizes the current one, autosaved immediately", async ({ context, baseUrl, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(baseUrl);
  const { windowId } = await tabByUrl(serviceWorker, baseUrl);

  await page.bringToFront();
  await page.keyboard.press("Control+b");
  await page.keyboard.press("N");
  await page.keyboard.type("work-e2e");
  await page.keyboard.press("Enter");

  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("work-e2e");
  expect(await windowCount(serviceWorker)).toBe(2); // a second window, not replaced in place
  await expect.poll(async () => {
    const w = await serviceWorker.evaluate((wid) => chrome.windows.get(wid), windowId);
    return w.state;
  }).toBe("minimized");
});

test("N + Shift+Enter replaces the window's tabs in place instead", async ({ context, baseUrl, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await page.bringToFront();
  await page.keyboard.press("Control+b");
  await page.keyboard.press("N");
  await page.keyboard.type("work-e2e-replace");
  await page.keyboard.press("Shift+Enter");

  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("work-e2e-replace");
  expect(await windowCount(serviceWorker)).toBe(1); // replaced in place, not a second window
});

test("the sessionReplaceDefault option flips N's plain Enter, and shift+enter always gets the other one", async ({ context, baseUrl, serviceWorker, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole("checkbox", { name: /replaces the current window by default/ }).check();
  await options.getByRole("button", { name: "save" }).click();
  await expect(options.locator("#ok")).toHaveClass(/show/);

  // With the default flipped, plain Enter now replaces this window in place —
  // which destroys the tab `plain` points to, so nothing further is driven
  // through it; everything past this point is checked via the service worker.
  // A genuinely separate window (not just another tab in the shared one) —
  // replace() operates window-wide, and it'd otherwise take the options tab
  // (and anything else sharing the window) down with it.
  const plain = await openWindow(context, serviceWorker, `${baseUrl}?plain`);
  const { windowId: plainWindowId } = await tabByUrl(serviceWorker, `${baseUrl}?plain`);

  await plain.bringToFront();
  await plain.keyboard.press("Control+b");
  await plain.keyboard.press("N");
  await plain.keyboard.type("flip-plain");
  await plain.keyboard.press("Enter");
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("flip-plain");
  await expect.poll(async () => {
    const tabs = await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), plainWindowId);
    return tabs.map((t) => t.url);
  }).toEqual(["chrome://newtab/"]); // this window's own tab became the fresh session
  expect((await serviceWorker.evaluate((wid) => chrome.windows.get(wid), plainWindowId)).state).not.toBe("minimized");

  // ...and shift+enter still gets the other (non-destructive) behavior.
  const shift = await openWindow(context, serviceWorker, `${baseUrl}?shift`);
  const { windowId: shiftWindowId } = await tabByUrl(serviceWorker, `${baseUrl}?shift`);
  const before = await windowCount(serviceWorker);

  await shift.bringToFront();
  await shift.keyboard.press("Control+b");
  await shift.keyboard.press("N");
  await shift.keyboard.type("flip-shift");
  await shift.keyboard.press("Shift+Enter");
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("flip-shift");
  await expect.poll(() => windowCount(serviceWorker)).toBe(before + 1); // a new window, not replaced in place
  await expect.poll(async () => {
    const w = await serviceWorker.evaluate((wid) => chrome.windows.get(wid), shiftWindowId);
    return w.state;
  }).toBe("minimized");
  expect((await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), shiftWindowId))
    .map((t) => t.url)).toEqual([`${baseUrl}?shift`]); // this window's own tab is untouched
});

test("s opens the session picker; Enter restores the selected session's tabs into a new window and minimizes the current one", async ({ context, baseUrl, serviceWorker }) => {
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
  const { windowId: targetWindowId } = await tabByUrl(serviceWorker, `${baseUrl}?scratch`);

  await target.bringToFront();
  await target.keyboard.press("Control+b");
  await target.keyboard.press("s");
  await expect(target.getByText("picker-test")).toBeVisible();
  await target.keyboard.press("Enter");

  // The invoking window's own tabs are left untouched, and it's minimized...
  await expect.poll(async () => {
    const w = await serviceWorker.evaluate((wid) => chrome.windows.get(wid), targetWindowId);
    return w.state;
  }).toBe("minimized");
  expect((await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), targetWindowId))
    .map((t) => t.url)).toEqual([`${baseUrl}?scratch`]);

  // ...while the session's tabs land in a brand-new window instead.
  await expect.poll(async () => (await tabByUrl(serviceWorker, `${baseUrl}?a`))?.windowId).toBeTruthy();
  const { windowId: newWindowId } = await tabByUrl(serviceWorker, `${baseUrl}?a`);
  await expect.poll(async () => {
    const tabs = await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), newWindowId);
    return tabs.map((t) => t.url).sort();
  }).toEqual([`${baseUrl}?a`, `${baseUrl}?b`].sort());
});

test("s opens the session picker; Shift+Enter replaces the current window's tabs in place", async ({ context, baseUrl, serviceWorker }) => {
  const anchor = await context.newPage();
  await anchor.goto(baseUrl); // keeps the browser alive throughout

  const source = await openWindow(context, serviceWorker, `${baseUrl}?a`);
  const source2 = await openTab(context, source, `${baseUrl}?b`);

  await source2.bringToFront();
  await source2.keyboard.press("Control+b");
  await source2.keyboard.press(":");
  await source2.keyboard.type("save picker-test-replace");
  await source2.keyboard.press("Enter");
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("picker-test-replace");

  // detach: closes this popup window so it's on disk but not live anywhere —
  // otherwise restoring it elsewhere would just attach/focus this window
  // instead of actually exercising a restore.
  await source2.keyboard.press("Control+b");
  await source2.keyboard.press("d");
  await replacePromptValue(source2, "picker-test-replace");
  await source2.keyboard.press("Enter");
  await expect.poll(() => source2.isClosed()).toBe(true);

  const target = await openWindow(context, serviceWorker, `${baseUrl}?scratch`);
  const { windowId } = await tabByUrl(serviceWorker, `${baseUrl}?scratch`);

  await target.bringToFront();
  await target.keyboard.press("Control+b");
  await target.keyboard.press("s");
  await expect(target.getByText("picker-test-replace")).toBeVisible();
  await target.keyboard.press("Shift+Enter");

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

test(": restore <name> (not just the picker) opens the saved session in a new window", async ({ context, baseUrl, serviceWorker }) => {
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

  // the invoking window is untouched (just minimized)...
  expect((await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), windowId))
    .map((t) => t.url)).toEqual([`${baseUrl}?scratch`]);

  // ...and the session's tabs show up in a new window instead.
  await expect.poll(async () => (await tabByUrl(serviceWorker, `${baseUrl}?a`))?.windowId).toBeTruthy();
  const { windowId: newWindowId } = await tabByUrl(serviceWorker, `${baseUrl}?a`);
  await expect.poll(async () => {
    const tabs = await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), newWindowId);
    return tabs.map((t) => t.url);
  }).toEqual([`${baseUrl}?a`]);
});

test(": restore! <name> replaces the current window's tabs in place", async ({ context, baseUrl, serviceWorker }) => {
  const anchor = await context.newPage();
  await anchor.goto(baseUrl);

  const source = await openWindow(context, serviceWorker, `${baseUrl}?a`);
  await source.bringToFront();
  await source.keyboard.press("Control+b");
  await source.keyboard.press(":");
  await source.keyboard.type("save colon-restore-bang");
  await source.keyboard.press("Enter");
  await expect.poll(async () => Object.keys(await sessionsStorage(serviceWorker))).toContain("colon-restore-bang");

  // detach so it's on disk but not live anywhere (see the `s` picker test
  // above for why that matters here)
  await source.keyboard.press("Control+b");
  await source.keyboard.press("d");
  await replacePromptValue(source, "colon-restore-bang");
  await source.keyboard.press("Enter");
  await expect.poll(() => source.isClosed()).toBe(true);

  const target = await openWindow(context, serviceWorker, `${baseUrl}?scratch`);
  const { windowId } = await tabByUrl(serviceWorker, `${baseUrl}?scratch`);

  await target.bringToFront();
  await target.keyboard.press("Control+b");
  await target.keyboard.press(":");
  await target.keyboard.type("restore! colon-restore-bang");
  await target.keyboard.press("Enter");

  await expect.poll(async () => {
    const tabs = await serviceWorker.evaluate((wid) => chrome.tabs.query({ windowId: wid }), windowId);
    return tabs.map((t) => t.url);
  }).toEqual([`${baseUrl}?a`]);
});
