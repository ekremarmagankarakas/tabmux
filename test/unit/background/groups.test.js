import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeChrome } from "../../mocks/chrome.js";

// groups.js itself has no import-time chrome calls, but it imports tabs.js,
// which registers a chrome.tabs.onActivated listener at import time — so
// this still needs the fresh-module-per-test treatment (see sessions.test.js
// for the fuller explanation).
let fake;
let groupsModule;

beforeEach(async () => {
  fake = createFakeChrome();
  globalThis.chrome = fake.chrome;
  vi.resetModules();
  groupsModule = await import("../../../src/background/groups.js");
});

describe("cycleGroup", () => {
  it("reports no groups when there are none", async () => {
    const { windowId, tabs } = fake.seedWindow([{}]);
    const res = await groupsModule.cycleGroup({ windowId, groupId: -1, id: tabs[0].id }, +1);
    expect(res.toast).toBe("no groups");
  });

  it("cycles forward through groups in tab-strip order and wraps", async () => {
    const { windowId, tabs } = fake.seedWindow([{}, {}, {}, {}]);
    const g1 = fake.addGroup(windowId, { title: "a" });
    const g2 = fake.addGroup(windowId, { title: "b" });
    await fake.chrome.tabs.group({ tabIds: [tabs[0].id], groupId: g1 });
    await fake.chrome.tabs.group({ tabIds: [tabs[2].id], groupId: g2 });

    const activeTab = { windowId, groupId: g1, id: tabs[0].id };
    const res = await groupsModule.cycleGroup(activeTab, +1);
    expect(res.toast).toBe("group: b");

    // now "in" g2 — cycling forward again wraps back to g1
    const wrapped = await groupsModule.cycleGroup({ windowId, groupId: g2, id: tabs[2].id }, +1);
    expect(wrapped.toast).toBe("group: a");
  });

  it("jumps to the first group when the active tab isn't in one", async () => {
    const { windowId, tabs } = fake.seedWindow([{}, {}]);
    const g1 = fake.addGroup(windowId, { title: "solo" });
    await fake.chrome.tabs.group({ tabIds: [tabs[1].id], groupId: g1 });

    const res = await groupsModule.cycleGroup({ windowId, groupId: -1, id: tabs[0].id }, -1);
    expect(res.toast).toBe("group: solo");
  });
});

describe("addToGroupByName", () => {
  it("requires a name", async () => {
    const { windowId, tabs } = fake.seedWindow([{}]);
    const res = await groupsModule.addToGroupByName({ windowId, id: tabs[0].id }, "");
    expect(res.error).toMatch(/usage/);
  });

  it("creates a new group when no matching title exists", async () => {
    const { windowId, tabs } = fake.seedWindow([{}]);
    const res = await groupsModule.addToGroupByName({ windowId, id: tabs[0].id }, "research");
    expect(res.toast).toBe("grouped: research");
    const groups = fake.allGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("research");
    expect(fake.getTab(tabs[0].id).groupId).toBe(groups[0].id);
  });

  it("joins an existing group by case-insensitive title match", async () => {
    const { windowId, tabs } = fake.seedWindow([{}, {}]);
    const groupId = fake.addGroup(windowId, { title: "Research" });
    await fake.chrome.tabs.group({ tabIds: [tabs[0].id], groupId });

    const res = await groupsModule.addToGroupByName({ windowId, id: tabs[1].id }, "research");
    expect(res.toast).toBe("grouped: research");
    expect(fake.getTab(tabs[1].id).groupId).toBe(groupId);
    expect(fake.allGroups()).toHaveLength(1); // didn't create a duplicate
  });
});

describe("removeFromGroup", () => {
  it("is a no-op toast when the tab isn't grouped", async () => {
    const { windowId, tabs } = fake.seedWindow([{}]);
    const res = await groupsModule.removeFromGroup({ windowId, groupId: -1, id: tabs[0].id });
    expect(res.toast).toBe("not in a group");
  });

  it("ungroups the tab", async () => {
    const { windowId, tabs } = fake.seedWindow([{}]);
    const groupId = fake.addGroup(windowId);
    await fake.chrome.tabs.group({ tabIds: [tabs[0].id], groupId });

    const res = await groupsModule.removeFromGroup({ windowId, groupId, id: tabs[0].id });
    expect(res.toast).toBe("ungrouped");
    expect(fake.getTab(tabs[0].id).groupId).toBe(-1);
  });
});

describe("listGroups", () => {
  it("returns groups in tab-strip order with counts and the current group id", async () => {
    const { windowId, tabs } = fake.seedWindow([{}, {}, {}, {}]);
    const g1 = fake.addGroup(windowId, { title: "first" });
    const g2 = fake.addGroup(windowId, { title: "second", collapsed: true });
    // Group g2 *before* g1 here, specifically to prove ordering follows tab
    // index (g1 owns indices 0-1, g2 owns index 2 — g1 first), not call order.
    await fake.chrome.tabs.group({ tabIds: [tabs[2].id], groupId: g2 });
    await fake.chrome.tabs.group({ tabIds: [tabs[0].id, tabs[1].id], groupId: g1 });

    const res = await groupsModule.listGroups({ windowId, groupId: g1, id: tabs[0].id });
    expect(res.currentGroupId).toBe(g1);
    expect(res.groups.map((g) => g.title)).toEqual(["first", "second"]);
    expect(res.groups[0].count).toBe(2);
    expect(res.groups[1].collapsed).toBe(true);
  });
});

it('creates a fresh named group for the current tab even when the name already exists', async () => {
  const { windowId, tabs } = fake.seedWindow([{}, {}]);
  const existing = fake.addGroup(windowId, { title: 'work' });
  await fake.chrome.tabs.group({ tabIds: [tabs[0].id, tabs[1].id], groupId: existing });
  await groupsModule.createGroup({ windowId, id: tabs[0].id }, ' work ');
  const createdId = fake.getTab(tabs[0].id).groupId;
  expect(createdId).not.toBe(existing);
  expect(fake.getTab(tabs[1].id).groupId).toBe(existing);
  expect(fake.allGroups().find(group => group.id === createdId).title).toBe('work');
});
