// Native Chrome tab-group operations: cycling between groups, adding/removing
// the current tab, and everything the group picker overlay needs.
import { orderedTabs } from "./tabs.js";

const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

// Groups in on-screen (tab-strip) order, derived from tab index rather than
// chrome.tabGroups.query() (which has no defined ordering).
async function orderedGroups(windowId) {
  const tabs = await orderedTabs(windowId);
  const ids = [];
  for (const t of tabs) {
    if (t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
    if (!ids.includes(t.groupId)) ids.push(t.groupId);
  }
  return ids;
}

async function focusGroupById(windowId, groupId) {
  const tabs = await chrome.tabs.query({ windowId, groupId });
  if (!tabs.length) return;
  const g = await chrome.tabGroups.get(groupId);
  if (g.collapsed) await chrome.tabGroups.update(groupId, { collapsed: false });
  const active = tabs.find((t) => t.active) || tabs[0];
  await chrome.tabs.update(active.id, { active: true });
}

export async function cycleGroup(tab, delta) {
  const groups = await orderedGroups(tab.windowId);
  if (!groups.length) return { ok: true, toast: "no groups" };
  const cur = groups.indexOf(tab.groupId);
  const next = cur === -1 ? groups[0] : groups[(cur + delta + groups.length) % groups.length];
  await focusGroupById(tab.windowId, next);
  const g = await chrome.tabGroups.get(next);
  return { ok: true, toast: `group: ${g.title || "(untitled)"}` };
}

export async function addToGroupByName(tab, name) {
  if (!name) return { error: "usage: group <name>" };
  const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
  const match = groups.find((g) => (g.title || "").toLowerCase() === name.toLowerCase());
  if (match) {
    await chrome.tabs.group({ tabIds: [tab.id], groupId: match.id });
  } else {
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, { title: name, color: GROUP_COLORS[groups.length % GROUP_COLORS.length] });
  }
  return { ok: true, toast: `grouped: ${name}` };
}

export async function addTabToGroupId(tab, groupId) {
  await chrome.tabs.group({ tabIds: [tab.id], groupId });
  return { ok: true, toast: "added to group" };
}

export async function removeFromGroup(tab) {
  if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return { ok: true, toast: "not in a group" };
  await chrome.tabs.ungroup([tab.id]);
  return { ok: true, toast: "ungrouped" };
}

export async function listGroups(tab) {
  const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
  const ordered = await orderedGroups(tab.windowId);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const rows = await Promise.all(
    ordered.map(async (id) => {
      const g = byId.get(id);
      const tabs = await chrome.tabs.query({ windowId: tab.windowId, groupId: id });
      return { id: g.id, title: g.title, color: g.color, collapsed: g.collapsed, count: tabs.length };
    })
  );
  return { ok: true, groups: rows, currentGroupId: tab.groupId };
}

export async function focusGroup(tab, groupId) {
  await focusGroupById(tab.windowId, groupId);
  return { ok: true };
}

export async function toggleGroupCollapse(groupId) {
  const g = await chrome.tabGroups.get(groupId);
  await chrome.tabGroups.update(groupId, { collapsed: !g.collapsed });
  return { ok: true };
}

export async function renameGroup(groupId, title) {
  await chrome.tabGroups.update(groupId, { title });
  return { ok: true, toast: `renamed: ${title}` };
}

export async function closeGroup(tab, groupId) {
  const tabs = await chrome.tabs.query({ windowId: tab.windowId, groupId });
  await chrome.tabs.remove(tabs.map((t) => t.id));
  return { ok: true, toast: "group closed" };
}
