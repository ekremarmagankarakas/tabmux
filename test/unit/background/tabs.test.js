import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeChrome } from "../../mocks/chrome.js";

// tabs.js registers a chrome.tabs.onActivated listener (and holds its own
// module-level `recent` state) at import time, so each test gets a genuinely
// fresh instance bound to that test's own fake chrome — vi.resetModules()
// plus a real dynamic import here (not through a shared helper: a relative
// specifier in import() resolves against *this* file's URL, so the path has
// to be written where the import actually happens).
let fake;
let tabsModule;

beforeEach(async () => {
  fake = createFakeChrome();
  globalThis.chrome = fake.chrome;
  vi.resetModules();
  tabsModule = await import("../../../src/background/tabs.js");
});

describe("orderedTabs", () => {
  it("returns tabs sorted by index", async () => {
    const { windowId, tabs } = fake.seedWindow([{}, {}, {}]);
    // scramble on-disk order to prove sorting, not insertion order, is used
    const ordered = await tabsModule.orderedTabs(windowId);
    expect(ordered.map((t) => t.id)).toEqual(tabs.map((t) => t.id));
  });
});

describe("cycleTab", () => {
  it("moves to the next tab and wraps around", async () => {
    const { windowId, tabs } = fake.seedWindow([{ active: true }, {}, {}]);
    const res = await tabsModule.cycleTab({ windowId }, +1);
    expect(res.toast).toBe("tab 2/3");
    expect(fake.getTab(tabs[1].id).active).toBe(true);

    // second step: 1 -> 2 (cycleTab reads the active flag it just set)
    const next = await tabsModule.cycleTab({ windowId }, +1);
    expect(next.toast).toBe("tab 3/3");
    expect(fake.getTab(tabs[2].id).active).toBe(true);
  });

  it("wraps backward past the start", async () => {
    const { windowId, tabs } = fake.seedWindow([{ active: true }, {}, {}]);
    const res = await tabsModule.cycleTab({ windowId }, -1);
    expect(res.toast).toBe("tab 3/3");
    expect(fake.getTab(tabs[2].id).active).toBe(true);
  });
});

describe("selectTab", () => {
  it("jumps window-wide when the active tab is ungrouped", async () => {
    const { windowId, tabs } = fake.seedWindow([{ active: true }, {}, {}]);
    const res = await tabsModule.selectTab({ windowId, groupId: -1 }, 3);
    expect(res.toast).toBe("tab 3/3");
    expect(fake.getTab(tabs[2].id).active).toBe(true);
  });

  it("scopes to the active tab's group when it's in one", async () => {
    const { windowId, tabs } = fake.seedWindow([{ active: true }, {}, {}, {}]);
    const groupId = fake.addGroup(windowId);
    await fake.chrome.tabs.group({ tabIds: [tabs[1].id, tabs[2].id], groupId });

    // Active tab (tabs[0]) is ungrouped, but we simulate "current tab is in
    // the group" by passing a tab context with that groupId, matching what
    // sender.tab would carry if the *active* tab were grouped.
    const res = await tabsModule.selectTab({ windowId, groupId }, 2);
    expect(res.toast).toBe("tab 2/2 (group)");
    expect(fake.getTab(tabs[2].id).active).toBe(true);
    // tabs[0] and tabs[3], outside the group, are never reachable by index here
    expect(fake.getTab(tabs[0].id).active).toBe(false);
  });

  it("reports a friendly miss instead of throwing", async () => {
    const { windowId } = fake.seedWindow([{ active: true }]);
    const res = await tabsModule.selectTab({ windowId, groupId: -1 }, 9);
    expect(res.toast).toBe("no tab 9");
  });
});

describe("newTab", () => {
  it("creates a plain tab when the invoking tab is ungrouped", async () => {
    const { windowId } = fake.seedWindow([{ active: true }]);
    await tabsModule.newTab({ windowId, groupId: -1 });
    const tabs = await fake.chrome.tabs.query({ windowId });
    expect(tabs).toHaveLength(2);
    expect(tabs[1].groupId).toBe(-1);
  });

  it("groups the new tab into the invoking tab's group", async () => {
    const { windowId, tabs } = fake.seedWindow([{ active: true }]);
    const groupId = fake.addGroup(windowId, { title: "work" });
    await fake.chrome.tabs.group({ tabIds: [tabs[0].id], groupId });

    await tabsModule.newTab({ windowId, groupId });
    const all = await fake.chrome.tabs.query({ windowId });
    const created = all.find((t) => t.id !== tabs[0].id);
    expect(created.groupId).toBe(groupId);
  });
});

describe("lastTab (recent-tab tracking)", () => {
  it("switches to the previously active tab", async () => {
    const { windowId, tabs } = fake.seedWindow([{}, {}, {}]);
    await fake.chrome.tabs.update(tabs[0].id, { active: true });
    await fake.chrome.tabs.update(tabs[1].id, { active: true });

    const res = await tabsModule.lastTab({ id: tabs[1].id, windowId });
    expect(res.toast).toBe("last tab");
    expect(fake.getTab(tabs[0].id).active).toBe(true);
  });

  it("does nothing (but doesn't throw) with no history", async () => {
    const { windowId, tabs } = fake.seedWindow([{ active: true }]);
    const res = await tabsModule.lastTab({ id: tabs[0].id, windowId });
    expect(res.toast).toBe("no previous tab");
  });
});
