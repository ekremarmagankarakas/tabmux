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
const SESSION_NAMES_KEY = "tabmux:sessionNames"; // chrome.storage.session, not .local

// windowId -> the session name that window is "for". Sourced by `newSession`,
// `saveSession`, and `restoreSession` — any of the three makes a window live.
//
// This has to survive an MV3 service-worker restart (Chrome evicts idle
// workers after ~30s) or "close all tabs in a session" silently stops
// killing the session: chrome.windows.onRemoved fires into a *fresh* worker
// whose sessionNames is empty, so it has no idea that window was ever live.
// chrome.storage.session is exactly this — in-memory, gone on browser close,
// but durable across worker restarts within the session — so the Map is
// mirrored there on every mutation and reloaded on worker startup.
// `sessionNamesReady` is awaited by every entry point that reads the map
// before this initial load could plausibly have finished.
const sessionNames = new Map();
export const sessionNamesReady = chrome.storage.session.get(SESSION_NAMES_KEY).then((s) => {
  for (const [windowId, name] of s[SESSION_NAMES_KEY] || []) sessionNames.set(windowId, name);
});
function persistSessionNames() {
  chrome.storage.session.set({ [SESSION_NAMES_KEY]: [...sessionNames.entries()] }).catch(() => {});
}
function setSessionName(windowId, name) {
  sessionNames.set(windowId, name);
  persistSessionNames();
}

const AUTOSAVE_DEBOUNCE_MS = 600;
const autoSaveTimers = new Map(); // windowId -> timeout handle

async function scheduleAutoSave(windowId) {
  await sessionNamesReady;
  if (windowId == null || !sessionNames.has(windowId)) return;
  clearTimeout(autoSaveTimers.get(windowId));
  autoSaveTimers.set(windowId, setTimeout(() => {
    autoSaveTimers.delete(windowId);
    saveSession({ windowId }).catch(() => {});
  }, AUTOSAVE_DEBOUNCE_MS));
}

// The two things every "this window is no longer (this) live session" path
// needs, pulled out so the four call sites can't drift out of sync with each
// other (or with a future third tracking map).
function cancelPendingAutosave(windowId) {
  clearTimeout(autoSaveTimers.get(windowId));
  autoSaveTimers.delete(windowId);
}
function untrackWindow(windowId) {
  sessionNames.delete(windowId);
  persistSessionNames();
  cancelPendingAutosave(windowId);
}

// A live session's window closing on its own (the user just closed all its
// tabs, not via `detach`) means the session dies with it — tmux kills a
// session when its last pane closes, and this is the same idea. `detach`
// untracks the window before it removes it, specifically so *its* save
// survives this listener.
chrome.windows.onRemoved.addListener(async (windowId) => {
  await sessionNamesReady;
  const name = sessionNames.get(windowId);
  if (name) await deleteSession(name).catch(() => {});
  untrackWindow(windowId);
});

// Tab create/close/navigate/move/pin — anything that changes what a session
// snapshot would contain — reschedules that window's autosave, if it's live.
chrome.tabs.onCreated.addListener((tab) => scheduleAutoSave(tab.windowId));
chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) scheduleAutoSave(removeInfo.windowId);
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  // groupId covers ungrouping/regrouping that doesn't also trigger a move or
  // a tabGroups event — e.g. `prefix B` on a tab already at a group's edge,
  // where nothing needs to physically reposition and the group itself (still
  // holding other tabs) doesn't change shape either.
  if (changeInfo.url !== undefined || changeInfo.pinned !== undefined || changeInfo.groupId !== undefined) {
    scheduleAutoSave(tab.windowId);
  }
});
chrome.tabs.onMoved.addListener((_tabId, moveInfo) => scheduleAutoSave(moveInfo.windowId));
chrome.tabs.onAttached.addListener((_tabId, attachInfo) => scheduleAutoSave(attachInfo.newWindowId));
chrome.tabs.onDetached.addListener((_tabId, detachInfo) => scheduleAutoSave(detachInfo.oldWindowId));

// Group rename/color/collapse (native Chrome UI or our own renameGroup/
// toggleGroupCollapse, both of which are just chrome.tabGroups.update calls)
// fire tabGroups events, not tabs events — without these, that state only
// gets captured next time some unrelated tab activity happens to trigger a
// save, which a distracted user + a ~30s-idle MV3 service-worker eviction
// can easily beat.
chrome.tabGroups.onUpdated.addListener((g) => scheduleAutoSave(g.windowId));
chrome.tabGroups.onCreated.addListener((g) => scheduleAutoSave(g.windowId));
chrome.tabGroups.onMoved.addListener((g) => scheduleAutoSave(g.windowId));
chrome.tabGroups.onRemoved.addListener((g) => scheduleAutoSave(g.windowId));

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
      untrackWindow(windowId); // stale — clean it up and keep looking
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

// saveSession/deleteSession each do a get-the-whole-blob, mutate, set-it-back
// on SESSIONS_KEY — with autosave debounced per-window rather than globally,
// two live sessions' timers can fire close enough together (well within
// storage.local's round-trip time) that one's write silently clobbers the
// other's, each holding its own now-stale full-blob snapshot. Routing every
// mutation through the same promise chain serializes them so each one's
// get-mutate-set always runs against the result of the last, not a stale copy.
let sessionsLock = Promise.resolve();
function withSessionsLock(mutate) {
  const result = sessionsLock.then(mutate, mutate);
  sessionsLock = result.then(() => {}, () => {});
  return result;
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

  // Not live anywhere, but might still exist on disk (saved earlier, then
  // detached, or from a previous browser session) — tmux errors on
  // `new -s <name>` for a name already in use rather than clobbering it, and
  // this should too. Without this check, reaching for `prefix N` out of
  // muscle memory instead of `prefix s` would silently wipe the *current*
  // window's tabs (never saved anywhere) and overwrite the stored session
  // with that empty result.
  if (await getSessions().then((s) => s[name])) {
    return { error: `session "${name}" already saved — use :restore ${name} or :kill ${name} first` };
  }

  // If this window already belongs to a *different* live session, flush its
  // latest state before wiping it — same reasoning as restoreSession.
  const previousName = sessionNames.get(tab.windowId);
  if (previousName && previousName !== name) {
    cancelPendingAutosave(tab.windowId);
    await saveSession(tab, previousName).catch(() => {});
  }

  const oldTabIds = (await chrome.tabs.query({ windowId: tab.windowId })).map((t) => t.id);
  await chrome.tabs.create({ windowId: tab.windowId, active: true }); // fresh blank tab
  if (oldTabIds.length) await chrome.tabs.remove(oldTabIds);

  setSessionName(tab.windowId, name);
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

  await withSessionsLock(async () => {
    const sessions = await getSessions();
    sessions[finalName] = { savedAt: Date.now(), tabs, groups };
    await putSessions(sessions);
  });
  setSessionName(tab.windowId, finalName);
  return { ok: true, toast: `saved "${finalName}" (${tabs.length})` };
}

export async function detach(tab, name) {
  await saveSession(tab, name);
  // Untrack before closing: this window is about to close on purpose, with
  // its save meant to survive — don't let the onRemoved listener above treat
  // that close as "the session died".
  untrackWindow(tab.windowId);
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
  if (!s) return { error: "empty or missing session" };

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
    cancelPendingAutosave(tab.windowId);
    await saveSession(tab, previousName).catch(() => {});
  }

  const oldTabIds = (await chrome.tabs.query({ windowId: tab.windowId })).map((t) => t.id);

  // A session can legitimately be saved with zero tabs (e.g. `prefix N`'s
  // seed save, before any real tab existed yet) — that's not the same thing
  // as missing, so it gets a blank tab instead of the "empty or missing"
  // error a truly-absent name returns above.
  const createdIds = [];
  if (s.tabs.length) {
    for (let i = 0; i < s.tabs.length; i++) {
      const t = s.tabs[i];
      const created = await chrome.tabs.create({ windowId: tab.windowId, url: t.url, pinned: !!t.pinned, active: i === 0 });
      createdIds.push(created.id);
    }
  } else {
    await chrome.tabs.create({ windowId: tab.windowId, active: true });
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

  setSessionName(tab.windowId, name);
  return { ok: true, toast: s.tabs.length ? `restored "${name}"` : `"${name}" is empty — starting fresh` };
}

export async function deleteSession(name) {
  await withSessionsLock(async () => {
    const sessions = await getSessions();
    delete sessions[name];
    await putSessions(sessions);
  });
  // Any window still tracking this name would otherwise resurrect the entry
  // on its very next tab event, via autosave resolving finalName back to it.
  for (const [windowId, n] of sessionNames) {
    if (n === name) untrackWindow(windowId);
  }
  return { ok: true, toast: `deleted "${name}"` };
}
