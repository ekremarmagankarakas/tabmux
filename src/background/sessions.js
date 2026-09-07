// Named, saved sets of tab URLs — save/list/restore/delete, plus "detach"
// (save the current window as a session, then close it) and "new session"
// (tmux `new -s <name>`: replace the invoking window with a fresh blank one
// tied to <name>, so later saves in that window don't need the name retyped).
//
// Any window with a remembered name is kept live: tab create/close/navigate/
// move/pin events for that window schedule a debounced autosave, so a named
// session stays up to date on its own — the way a tmux session always is —
// instead of only capturing state at an explicit `save`/`detach`.
import { orderedTabs } from "./tabs.js";

const SESSIONS_KEY = "tabmux:sessions";

// windowId -> the session name that window is "for". Sourced by `newSession`,
// `saveSession`, and `restoreSession` — any of the three makes a window live.
// Best-effort, not persisted — same tradeoff as the recent-tab tracking in
// tabs.js: a service-worker restart just means autosave/defaults pause until
// the next explicit save, saved data itself is untouched.
const sessionNames = new Map();

const AUTOSAVE_DEBOUNCE_MS = 600;
const autoSaveTimers = new Map(); // windowId -> timeout handle

function scheduleAutoSave(windowId) {
  if (windowId == null || !sessionNames.has(windowId)) return;
  clearTimeout(autoSaveTimers.get(windowId));
  autoSaveTimers.set(windowId, setTimeout(() => {
    autoSaveTimers.delete(windowId);
    saveSession({ windowId }).catch(() => {});
  }, AUTOSAVE_DEBOUNCE_MS));
}

// A live session's window closing on its own (the user just closed all its
// tabs, not via `detach`) means the session dies with it — tmux kills a
// session when its last pane closes, and this is the same idea. `detach`
// untracks the window before it removes it, specifically so *its* save
// survives this listener.
chrome.windows.onRemoved.addListener((windowId) => {
  const name = sessionNames.get(windowId);
  if (name) deleteSession(name).catch(() => {});
  sessionNames.delete(windowId);
  clearTimeout(autoSaveTimers.get(windowId));
  autoSaveTimers.delete(windowId);
});

// Tab create/close/navigate/move/pin — anything that changes what a session
// snapshot would contain — reschedules that window's autosave, if it's live.
chrome.tabs.onCreated.addListener((tab) => scheduleAutoSave(tab.windowId));
chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) scheduleAutoSave(removeInfo.windowId);
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined || changeInfo.pinned !== undefined) scheduleAutoSave(tab.windowId);
});
chrome.tabs.onMoved.addListener((_tabId, moveInfo) => scheduleAutoSave(moveInfo.windowId));
chrome.tabs.onAttached.addListener((_tabId, attachInfo) => scheduleAutoSave(attachInfo.newWindowId));
chrome.tabs.onDetached.addListener((_tabId, detachInfo) => scheduleAutoSave(detachInfo.oldWindowId));

function skip(url) {
  return !url || url.startsWith("chrome://newtab") || url.startsWith("chrome-extension://");
}

// Finds the window currently live for `name`, if any — the dedup check for
// both newSession and restoreSession. Verifies the window still actually
// exists rather than trusting the map blindly: onRemoved should always keep
// sessionNames in sync, but a stale entry would otherwise throw deep inside
// chrome.windows.update instead of just falling through to "not live".
async function findLiveWindow(name) {
  for (const [windowId, n] of sessionNames) {
    if (n !== name) continue;
    try {
      await chrome.windows.get(windowId);
      return windowId;
    } catch {
      sessionNames.delete(windowId); // stale — clean it up and keep looking
    }
  }
  return null;
}

async function getSessions() {
  const store = await chrome.storage.local.get(SESSIONS_KEY);
  return store[SESSIONS_KEY] || {};
}
async function putSessions(sessions) {
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
}

// Replaces the window this was invoked from with a fresh blank session,
// the way `tmux new -s name` repurposes the terminal you're sitting in
// rather than opening a second one — mirrors restoreSession's replace logic.
// Seeds an initial (likely empty — the only tab is the blank new-tab page,
// filtered by skip()) save so it shows up in the session picker right away;
// autosave takes over from there as you add tabs. If `name` is already
// running somewhere, switches to that window instead of spinning up a
// duplicate.
export async function newSession(tab, name) {
  if (!name) return { error: "usage: session <name>" };

  const existing = await findLiveWindow(name);
  if (existing != null) {
    if (existing === tab.windowId) return { ok: true, toast: `already viewing "${name}"` };
    await chrome.windows.update(existing, { focused: true });
    return { ok: true, toast: `session "${name}" already running — switched to it` };
  }

  // If this window already belongs to a *different* live session, flush its
  // latest state before wiping it — same reasoning as restoreSession.
  const previousName = sessionNames.get(tab.windowId);
  if (previousName && previousName !== name) {
    clearTimeout(autoSaveTimers.get(tab.windowId));
    autoSaveTimers.delete(tab.windowId);
    await saveSession(tab, previousName).catch(() => {});
  }

  const oldTabIds = (await chrome.tabs.query({ windowId: tab.windowId })).map((t) => t.id);
  await chrome.tabs.create({ windowId: tab.windowId, active: true }); // fresh blank tab
  if (oldTabIds.length) await chrome.tabs.remove(oldTabIds);

  sessionNames.set(tab.windowId, name);
  await saveSession(tab, name);
  return { ok: true, toast: `session "${name}" started — autosaving as you go` };
}

export async function getSessionName(tab) {
  return { ok: true, name: sessionNames.get(tab.windowId) || null };
}

export async function saveSession(tab, name) {
  const finalName = name || sessionNames.get(tab.windowId);
  if (!finalName) return { error: "usage: save <name>" };

  const rawTabs = (await orderedTabs(tab.windowId)).filter((t) => !skip(t.url));
  const tabs = rawTabs.map((t) => ({
    url: t.url,
    pinned: !!t.pinned,
    // The live groupId itself won't exist anymore next time this is
    // restored — it's only kept here to correlate which tabs shared a
    // group; `groups` below carries the group's actual title/color/state.
    groupId: t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? t.groupId : null,
  }));
  const usedGroupIds = [...new Set(tabs.map((t) => t.groupId).filter((id) => id != null))];
  const liveGroups = usedGroupIds.length ? await chrome.tabGroups.query({ windowId: tab.windowId }) : [];
  const groups = usedGroupIds.map((id) => {
    const g = liveGroups.find((lg) => lg.id === id);
    return { id, title: g ? g.title : "", color: g ? g.color : "grey", collapsed: g ? g.collapsed : false };
  });

  const sessions = await getSessions();
  sessions[finalName] = { savedAt: Date.now(), tabs, groups };
  await putSessions(sessions);
  sessionNames.set(tab.windowId, finalName);
  return { ok: true, toast: `saved "${finalName}" (${tabs.length})` };
}

export async function detach(tab, name) {
  await saveSession(tab, name);
  // Untrack before closing: this window is about to close on purpose, with
  // its save meant to survive — don't let the onRemoved listener above treat
  // that close as "the session died".
  sessionNames.delete(tab.windowId);
  clearTimeout(autoSaveTimers.get(tab.windowId));
  autoSaveTimers.delete(tab.windowId);
  try { await chrome.windows.remove(tab.windowId); } catch (_) {}
  return { ok: true };
}

export async function listSessions() {
  const sessions = await getSessions();
  return {
    ok: true,
    sessions: Object.entries(sessions)
      .map(([name, s]) => ({ name, count: s.tabs.length, savedAt: s.savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt),
  };
}

// Replaces the window the restore was invoked from with the session's tabs,
// rather than opening a separate window: create the session's tabs first,
// then close whatever was there before (in that order, so the window is
// never briefly left with zero tabs — Chrome would just close it).
//
// If `name` is already open in some window, this is an attach, not a
// recreate: switch to that window instead of materializing a second copy of
// tabs from the (necessarily slightly stale, snapshot-based) saved data.
export async function restoreSession(tab, name) {
  const sessions = await getSessions();
  const s = sessions[name];
  if (!s || !s.tabs.length) return { error: "empty or missing session" };

  const existing = await findLiveWindow(name);
  if (existing != null) {
    if (existing === tab.windowId) return { ok: true, toast: `already viewing "${name}"` };
    await chrome.windows.update(existing, { focused: true });
    return { ok: true, toast: `"${name}" already open — switched to it` };
  }

  // If this window already belongs to a *different* live session, flush its
  // latest state before overwriting it — don't lean on the autosave debounce
  // alone here. A restore fired within that debounce window would otherwise
  // cancel the old session's pending save and let it get relabeled under the
  // new name once the timer fires, silently losing whatever changed last.
  const previousName = sessionNames.get(tab.windowId);
  if (previousName && previousName !== name) {
    clearTimeout(autoSaveTimers.get(tab.windowId));
    autoSaveTimers.delete(tab.windowId);
    await saveSession(tab, previousName).catch(() => {});
  }

  const oldTabIds = (await chrome.tabs.query({ windowId: tab.windowId })).map((t) => t.id);

  const createdIds = [];
  for (let i = 0; i < s.tabs.length; i++) {
    const t = s.tabs[i];
    const created = await chrome.tabs.create({ windowId: tab.windowId, url: t.url, pinned: !!t.pinned, active: i === 0 });
    createdIds.push(created.id);
  }
  if (oldTabIds.length) await chrome.tabs.remove(oldTabIds);

  // Re-form tab groups: each saved group's id is just a correlation key here
  // (the original Chrome group is long gone) — gather the newly created tabs
  // that shared it, group them fresh, then reapply the saved title/color/
  // collapsed state. Sessions saved before groups were tracked have no
  // `groups` at all, so this is a no-op for them.
  for (const g of s.groups || []) {
    const memberIds = s.tabs
      .map((t, i) => (t.groupId === g.id ? createdIds[i] : null))
      .filter((id) => id != null);
    if (!memberIds.length) continue;
    const newGroupId = await chrome.tabs.group({ tabIds: memberIds });
    await chrome.tabGroups.update(newGroupId, { title: g.title, color: g.color, collapsed: g.collapsed });
  }

  sessionNames.set(tab.windowId, name);
  return { ok: true, toast: `restored "${name}"` };
}

export async function deleteSession(name) {
  const sessions = await getSessions();
  delete sessions[name];
  await putSessions(sessions);
  return { ok: true, toast: `deleted "${name}"` };
}
