// tabmux — background service worker
// Handles everything that needs chrome.tabs / chrome.windows / chrome.storage,
// driven by messages from the content script's modal command layer.

const SESSIONS_KEY = "tabmux:sessions";

// Best-effort per-window recent-tab stack for "last tab" (prefix + Tab).
// Service workers can be evicted, so this is not persisted — that's fine.
const recent = new Map(); // windowId -> [tabId, ...]

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const arr = (recent.get(windowId) || []).filter((id) => id !== tabId);
  arr.unshift(tabId);
  recent.set(windowId, arr.slice(0, 25));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((r) => sendResponse(r || { ok: true }))
    .catch((err) => sendResponse({ error: String(err && err.message || err) }));
  return true; // keep the channel open for the async response
});

async function handle(msg, sender) {
  const tab = sender.tab; // the tab the command was issued from
  switch (msg.type) {
    case "new-tab":     await chrome.tabs.create({}); return { ok: true, toast: "new tab" };
    case "close-tab":   if (tab) await chrome.tabs.remove(tab.id); return { ok: true };
    case "next-tab":    return cycleTab(tab, +1);
    case "prev-tab":    return cycleTab(tab, -1);
    case "select-tab":  return selectTab(tab, msg.index);
    case "last-tab":    return lastTab(tab);
    case "split":       return splitWindow(tab, msg.dir);
    case "focus-window":return focusWindow(tab, msg.dir);
    case "zoom":        return zoomWindow(tab);
    case "tile":        return tileWindows(tab);
    case "detach":      return detach(tab, msg.name);
    case "save-session":return saveSession(tab, msg.name);
    case "list-sessions": return listSessions();
    case "restore-session": return restoreSession(msg.name);
    case "delete-session":  return deleteSession(msg.name);
    default: return { error: "unknown command: " + msg.type };
  }
}

/* ---------- tabs (tmux "windows") ---------- */

async function orderedTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.sort((a, b) => a.index - b.index);
}

async function cycleTab(tab, delta) {
  const tabs = await orderedTabs(tab.windowId);
  const cur = tabs.findIndex((t) => t.active);
  const next = (cur + delta + tabs.length) % tabs.length;
  await chrome.tabs.update(tabs[next].id, { active: true });
  return { ok: true, toast: `tab ${next + 1}/${tabs.length}` };
}

async function selectTab(tab, index) {
  const tabs = await orderedTabs(tab.windowId);
  const t = tabs[index - 1];
  if (t) { await chrome.tabs.update(t.id, { active: true }); return { ok: true, toast: `tab ${index}` }; }
  return { ok: true, toast: `no tab ${index}` };
}

async function lastTab(tab) {
  const arr = recent.get(tab.windowId) || [];
  const prev = arr.find((id) => id !== tab.id);
  if (prev != null) { try { await chrome.tabs.update(prev, { active: true }); } catch (_) {} }
  return { ok: true, toast: "last tab" };
}

/* ---------- windows (tmux "panes"), tiled like a WM ---------- */

async function workAreaFor(win) {
  const displays = await chrome.system.display.getInfo();
  const cx = win.left + win.width / 2;
  const cy = win.top + win.height / 2;
  const hit = displays.find(
    (d) =>
      cx >= d.workArea.left && cx < d.workArea.left + d.workArea.width &&
      cy >= d.workArea.top && cy < d.workArea.top + d.workArea.height
  );
  return (hit || displays[0]).workArea;
}

async function splitWindow(tab, dir) {
  const win = await chrome.windows.get(tab.windowId);
  const wa = await workAreaFor(win);
  let a, b;
  if (dir === "vertical") {
    // side by side (tmux %)
    const half = Math.floor(wa.width / 2);
    a = { left: wa.left, top: wa.top, width: half, height: wa.height };
    b = { left: wa.left + half, top: wa.top, width: wa.width - half, height: wa.height };
  } else {
    // stacked (tmux ")
    const half = Math.floor(wa.height / 2);
    a = { left: wa.left, top: wa.top, width: wa.width, height: half };
    b = { left: wa.left, top: wa.top + half, width: wa.width, height: wa.height - half };
  }
  await chrome.windows.update(win.id, { state: "normal", ...a });
  await chrome.windows.create({ ...b, focused: true });
  return { ok: true, toast: dir === "vertical" ? "split ↔" : "split ↕" };
}

async function focusWindow(tab, dir) {
  const cur = await chrome.windows.get(tab.windowId);
  const wins = (await chrome.windows.getAll()).filter((w) => w.type === "normal");
  if (dir === "next") {
    const idx = wins.findIndex((w) => w.id === cur.id);
    const nxt = wins[(idx + 1) % wins.length];
    if (nxt) await chrome.windows.update(nxt.id, { focused: true, drawAttention: true });
    return { ok: true, toast: "next pane" };
  }
  const others = wins.filter((w) => w.id !== cur.id);
  const ccx = cur.left + cur.width / 2, ccy = cur.top + cur.height / 2;
  let best = null, bestScore = Infinity;
  for (const w of others) {
    const dx = w.left + w.width / 2 - ccx;
    const dy = w.top + w.height / 2 - ccy;
    let ok = false, score = 0;
    if (dir === "left"  && dx < -20) { ok = true; score = Math.abs(dx) + Math.abs(dy) * 3; }
    if (dir === "right" && dx >  20) { ok = true; score = Math.abs(dx) + Math.abs(dy) * 3; }
    if (dir === "up"    && dy < -20) { ok = true; score = Math.abs(dy) + Math.abs(dx) * 3; }
    if (dir === "down"  && dy >  20) { ok = true; score = Math.abs(dy) + Math.abs(dx) * 3; }
    if (ok && score < bestScore) { bestScore = score; best = w; }
  }
  if (best) await chrome.windows.update(best.id, { focused: true, drawAttention: true });
  return { ok: true, toast: best ? `focus ${dir}` : `no pane ${dir}` };
}

async function zoomWindow(tab) {
  const win = await chrome.windows.get(tab.windowId);
  const state = win.state === "maximized" ? "normal" : "maximized";
  await chrome.windows.update(win.id, { state });
  return { ok: true, toast: state === "maximized" ? "zoom" : "unzoom" };
}

async function tileWindows(tab) {
  const cur = await chrome.windows.get(tab.windowId);
  const wa = await workAreaFor(cur);
  const wins = (await chrome.windows.getAll()).filter((w) => w.type === "normal");
  const n = wins.length || 1;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cw = Math.floor(wa.width / cols);
  const ch = Math.floor(wa.height / rows);
  for (let i = 0; i < wins.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    await chrome.windows.update(wins[i].id, {
      state: "normal",
      left: wa.left + c * cw,
      top: wa.top + r * ch,
      width: cw,
      height: ch,
    });
  }
  return { ok: true, toast: `tiled ${wins.length}` };
}

/* ---------- sessions ---------- */

function skip(url) {
  return !url || url.startsWith("chrome://newtab") || url.startsWith("chrome-extension://");
}

async function getSessions() {
  const store = await chrome.storage.local.get(SESSIONS_KEY);
  return store[SESSIONS_KEY] || {};
}
async function putSessions(sessions) {
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
}

async function saveSession(tab, name) {
  const tabs = (await orderedTabs(tab.windowId))
    .filter((t) => !skip(t.url))
    .map((t) => ({ url: t.url, pinned: !!t.pinned }));
  const sessions = await getSessions();
  sessions[name] = { savedAt: Date.now(), tabs };
  await putSessions(sessions);
  return { ok: true, toast: `saved "${name}" (${tabs.length})` };
}

async function detach(tab, name) {
  await saveSession(tab, name);
  try { await chrome.windows.remove(tab.windowId); } catch (_) {}
  return { ok: true };
}

async function listSessions() {
  const sessions = await getSessions();
  return {
    ok: true,
    sessions: Object.entries(sessions)
      .map(([name, s]) => ({ name, count: s.tabs.length, savedAt: s.savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt),
  };
}

async function restoreSession(name) {
  const sessions = await getSessions();
  const s = sessions[name];
  if (!s || !s.tabs.length) return { error: "empty or missing session" };
  const win = await chrome.windows.create({ url: s.tabs.map((t) => t.url), focused: true });
  // re-pin what was pinned
  s.tabs.forEach((t, i) => {
    if (t.pinned && win.tabs && win.tabs[i]) {
      chrome.tabs.update(win.tabs[i].id, { pinned: true }).catch(() => {});
    }
  });
  return { ok: true, toast: `restored "${name}"` };
}

async function deleteSession(name) {
  const sessions = await getSessions();
  delete sessions[name];
  await putSessions(sessions);
  return { ok: true, toast: `deleted "${name}"` };
}
