// Tab operations: ordering, cycling, direct selection, and "last active tab".

// Best-effort per-window recent-tab stack for "last tab" (prefix + Tab).
// Service workers can be evicted, so this is not persisted — that's fine.
const recent = new Map(); // windowId -> [tabId, ...]

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const arr = (recent.get(windowId) || []).filter((id) => id !== tabId);
  arr.unshift(tabId);
  recent.set(windowId, arr.slice(0, 25));
});

// New tab lands in the active tab's group if there is one — matches editing
// a grouped buffer and expecting new splits to stay in context — else it's
// just a normal tab in the window.
export async function newTab(tab) {
  const created = await chrome.tabs.create({ windowId: tab.windowId });
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    await chrome.tabs.group({ tabIds: [created.id], groupId: tab.groupId });
  }
  return { ok: true, toast: "new tab" };
}

export async function orderedTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.sort((a, b) => a.index - b.index);
}

export async function cycleTab(tab, delta) {
  const tabs = await orderedTabs(tab.windowId);
  const cur = tabs.findIndex((t) => t.active);
  const next = (cur + delta + tabs.length) % tabs.length;
  await chrome.tabs.update(tabs[next].id, { active: true });
  return { ok: true, toast: `tab ${next + 1}/${tabs.length}` };
}

// Jumps to the Nth tab, scoped to the active tab's group when it's in one —
// so `prefix 1-9` navigates within a group the way you'd expect once you're
// grouped, instead of always indexing the whole window. Ungrouped tabs keep
// the old window-wide behavior (there's no group to scope to).
export async function selectTab(tab, index) {
  const tabs = await orderedTabs(tab.windowId);
  const inGroup = tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
  const scoped = inGroup ? tabs.filter((t) => t.groupId === tab.groupId) : tabs;
  const t = scoped[index - 1];
  if (!t) return { ok: true, toast: `no tab ${index}` + (inGroup ? " in group" : "") };
  await chrome.tabs.update(t.id, { active: true });
  return { ok: true, toast: `tab ${index}/${scoped.length}` + (inGroup ? " (group)" : "") };
}

export async function lastTab(tab) {
  const arr = recent.get(tab.windowId) || [];
  const prev = arr.find((id) => id !== tab.id);
  if (prev != null) { try { await chrome.tabs.update(prev, { active: true }); } catch (_) {} }
  return { ok: true, toast: "last tab" };
}
