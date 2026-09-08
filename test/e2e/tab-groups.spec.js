// prefix g / G / t / S / B — tab group navigation, the group picker, sending
// a tab into a group, and breaking one out.
import { test, expect } from "./fixtures.js";
import { activeUrl, tabByUrl } from "./helpers.js";

const TAB_GROUP_ID_NONE = -1;

test("g / G cycle between tab groups in tab-strip order and wrap", async ({ context, baseUrl, serviceWorker }) => {
  const urls = ["a", "b", "c"].map((s) => `${baseUrl}?${s}`);
  const pages = [];
  for (const url of urls) {
    const p = await context.newPage();
    await p.goto(url);
    pages.push(p);
  }

  // Real chrome.tabGroups, set up directly through the service worker —
  // this is the seam Playwright gives us into the extension's own
  // privileged context, so setup doesn't have to go through the UI too.
  await serviceWorker.evaluate(async ([urlA, urlB]) => {
    const tabs = await chrome.tabs.query({});
    const g1 = await chrome.tabs.group({ tabIds: [tabs.find((t) => t.url === urlA).id] });
    await chrome.tabGroups.update(g1, { title: "one" });
    const g2 = await chrome.tabs.group({ tabIds: [tabs.find((t) => t.url === urlB).id] });
    await chrome.tabGroups.update(g2, { title: "two" });
  }, [urls[0], urls[1]]);

  await pages[0].bringToFront();
  await pages[0].keyboard.press("Control+b");
  await pages[0].keyboard.press("g");
  await expect.poll(() => activeUrl(serviceWorker)).toBe(urls[1]);

  await pages[1].keyboard.press("Control+b");
  await pages[1].keyboard.press("g"); // wraps past ungrouped "c" back to "one"
  await expect.poll(() => activeUrl(serviceWorker)).toBe(urls[0]);

  await pages[0].keyboard.press("Control+b");
  await pages[0].keyboard.press("G"); // backward wraps the other way, to "two"
  await expect.poll(() => activeUrl(serviceWorker)).toBe(urls[1]);
});

test("t opens the group picker; Enter jumps to the selected group", async ({ context, baseUrl, serviceWorker }) => {
  const a = await context.newPage();
  await a.goto(`${baseUrl}?a`);
  const b = await context.newPage();
  await b.goto(`${baseUrl}?b`);

  await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const g = await chrome.tabs.group({ tabIds: [tabs.find((t) => t.url === url).id] });
    await chrome.tabGroups.update(g, { title: "target-group" });
  }, `${baseUrl}?b`);

  await a.bringToFront();
  await a.keyboard.press("Control+b");
  await a.keyboard.press("t");

  await expect(a.getByText("target-group")).toBeVisible();
  await a.keyboard.press("Enter"); // only group listed, selected by default

  await expect.poll(() => activeUrl(serviceWorker)).toBe(`${baseUrl}?b`);
});

test("S sends the current tab into an existing group", async ({ context, baseUrl, serviceWorker }) => {
  const a = await context.newPage();
  await a.goto(`${baseUrl}?a`); // will be sent
  const b = await context.newPage();
  await b.goto(`${baseUrl}?b`); // pre-grouped destination

  const destGroupId = await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const g = await chrome.tabs.group({ tabIds: [tabs.find((t) => t.url === url).id] });
    await chrome.tabGroups.update(g, { title: "dest" });
    return g;
  }, `${baseUrl}?b`);

  await a.bringToFront();
  await a.keyboard.press("Control+b");
  await a.keyboard.press("S");
  await expect(a.getByText("dest")).toBeVisible();
  await a.keyboard.press("Enter");

  await expect.poll(async () => (await tabByUrl(serviceWorker, `${baseUrl}?a`))?.groupId).toBe(destGroupId);
});

test("B breaks the current tab out of its group", async ({ context, baseUrl, serviceWorker }) => {
  const a = await context.newPage();
  await a.goto(`${baseUrl}?a`);

  await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    await chrome.tabs.group({ tabIds: [tabs.find((t) => t.url === url).id] });
  }, `${baseUrl}?a`);

  await expect.poll(async () => (await tabByUrl(serviceWorker, `${baseUrl}?a`))?.groupId).not.toBe(TAB_GROUP_ID_NONE);

  await a.bringToFront();
  await a.keyboard.press("Control+b");
  await a.keyboard.press("B");

  await expect.poll(async () => (await tabByUrl(serviceWorker, `${baseUrl}?a`))?.groupId).toBe(TAB_GROUP_ID_NONE);
});

test('T prompts for a new group name and groups the current tab', async ({context,baseUrl,serviceWorker}) => {
  const page = await context.newPage(); await page.goto(baseUrl);
  await page.keyboard.press('Control+b'); await page.keyboard.press('T');
  await expect(page.getByRole('textbox',{name:'new group:'})).toBeVisible();
  await page.getByRole('textbox',{name:'new group:'}).fill('research');
  await page.keyboard.press('Enter');
  await expect.poll(async () => {
    return serviceWorker.evaluate(async () => {
      const groups = await chrome.tabGroups.query({title:'research'});
      if (!groups.length) return [];
      return (await chrome.tabs.query({groupId:groups[0].id})).map(tab => tab.url);
    });
  }).toEqual([baseUrl]);
});
