// Thin wrappers around serviceWorker.evaluate(...) for the ground-truth
// checks e2e tests need: which tab is active, what group a tab is in, what's
// actually in storage. These call the real chrome.* APIs, not tabmux's code.

export async function activeUrl(serviceWorker) {
  const tabs = await serviceWorker.evaluate(() => chrome.tabs.query({ active: true }));
  return tabs[0]?.url;
}

export function tabByUrl(serviceWorker, url) {
  return serviceWorker.evaluate(
    (u) => chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url === u)),
    url,
  );
}

export function sessionsStorage(serviceWorker) {
  return serviceWorker.evaluate(() =>
    chrome.storage.local.get("tabmux:sessions").then((s) => s["tabmux:sessions"] || {})
  );
}

export function windowCount(serviceWorker) {
  return serviceWorker.evaluate(() => chrome.windows.getAll().then((w) => w.length));
}

export function groupTitle(serviceWorker, groupId) {
  return serviceWorker.evaluate((id) => chrome.tabGroups.get(id).then((g) => g.title), groupId);
}

// A persistent context launches with one pre-existing about:blank tab that
// has nothing to do with the test — left alone, it throws off index/order
// assumptions (e.g. "wrap forward to the first tab" lands on it instead of
// the first tab a test actually created). Tests that care about tab order
// close it once they have at least one tab of their own open.
export async function closeInitialBlankTab(serviceWorker) {
  await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: ["about:blank", "chrome://newtab/"] });
    await Promise.all(tabs.map((t) => chrome.tabs.remove(t.id).catch(() => {})));
  });
}

// Opens `url` as a genuinely separate Chrome window. window.open(url, "_blank",
// "popup") turned out not to reliably produce a real separate window under
// CDP automation in practice (it can land as just another tab, silently
// breaking any test that assumes closing it won't take a "sibling" page with
// it) — going straight through the real chrome.windows.create API via the
// service worker sidesteps that heuristic entirely.
export async function openWindow(context, serviceWorker, url) {
  const [page] = await Promise.all([
    context.waitForEvent("page"),
    serviceWorker.evaluate((u) => chrome.windows.create({ url: u }), url),
  ]);
  await page.waitForLoadState();
  return page;
}

// Opens `url` as a new tab in the same window as fromPage. context.newPage()
// reliably lands in the same window as other pages created the same way, so
// this is just that plus navigation, kept as a named helper for symmetry
// with openWindow at call sites.
export async function openTab(context, fromPage, url) {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}
