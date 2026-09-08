// Session operations are serialized from ownership check through snapshot and
// browser mutation. Event-driven autosaves join the same queue.
import { orderedTabs } from './tabs.js';
const KEY = 'tabmux:sessions';
const NAMES = 'tabmux:sessionNames';
const STATUS = 'tabmux:saveStatus';
const RECOVERY = 'tabmux:recovery';
const TRANSITIONS = 'tabmux:transitions';
const names = new Map();
const statuses = new Map();
const timers = new Map();
const revisions = new Map();
const transitioning = new Set();
const journals = new Set();
let queue = Promise.resolve();
export const sessionNamesReady = chrome.storage.session.get(NAMES).then(async (s) => {
  let duplicate = false;
  for (const [id, name] of s[NAMES] || []) {
    for (const [oldId, oldName] of names) if (oldName === name) { names.delete(oldId); duplicate = true; }
    names.set(id, name);
  }
  if (duplicate) await chrome.storage.session.set({ [NAMES]:[...names] });
  const stored = await chrome.storage.session.get(STATUS);
  for (const [id, status] of stored[STATUS] || []) statuses.set(id, status);
  const pending = await chrome.storage.session.get(TRANSITIONS);
  for (const id of pending[TRANSITIONS] || []) {
    // Never autosave a half-restored window after worker termination.
    names.delete(id);
    statuses.set(id, { error:'A session switch was interrupted. Restore a saved session or Recovery from the toolbar.', name:null });
  }
  if (pending[TRANSITIONS]?.length) {
    await chrome.storage.session.set({ [NAMES]:[...names], [STATUS]:[...statuses], [TRANSITIONS]:[] });
  }
  await persistStatus();
});
function serial(fn) {
  const result = queue.then(async () => { await sessionNamesReady; return fn(); });
  queue = result.catch(() => {});
  return result;
}
async function journal(id, active) {
  if (active) journals.add(id); else journals.delete(id);
  await chrome.storage.session.set({ [TRANSITIONS]:[...journals] });
}
function cancel(id) { clearTimeout(timers.get(id)); timers.delete(id); }
async function track(id, name) {
  const next = new Map(names);
  if (name) next.set(id, name); else next.delete(id);
  await chrome.storage.session.set({ [NAMES]: [...next] });
  names.clear(); for (const entry of next) names.set(...entry);
  cancel(id);
}
async function persistStatus() {
  // The visible badge and in-memory status still work if persistence itself fails.
  await chrome.storage.session.set({ [STATUS]: [...statuses] }).catch(console.error);
  await chrome.action?.setBadgeText({ text: [...statuses.values()].some(s => s.error) ? '!' : '' }).catch(console.error);
  await chrome.action?.setBadgeBackgroundColor({ color: '#b9382f' }).catch(console.error);
}
async function status(id, error = null, pendingName = null) {
  const value = { error, pendingName, name: names.get(id) || null };
  statuses.set(id, value);
  await persistStatus();
  const tabs = await chrome.tabs.query({ windowId: id }).catch(() => []);
  await Promise.all(tabs.map(t => chrome.tabs.sendMessage?.(t.id, { type: 'save-status', ...value }).catch(() => {})));
  await chrome.runtime.sendMessage({type:'save-status', windowId:id, ...value})?.catch(() => {});
}
function operation(tab, fn, pendingName) {
  return serial(async () => {
    try { return await fn(); }
    catch (e) { await status(tab.windowId, e.message, typeof pendingName === 'function' ? pendingName() : pendingName).catch(console.error); throw e; }
  });
}
function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new Error('Use a session name between 1 and 200 characters');
  return name.trim();
}
async function read() {
  const store = await chrome.storage.local.get(KEY);
  const value = store[KEY] || {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved sessions are invalid; restore a backup');
  return Object.assign(Object.create(null), value);
}
async function write(name, snapshot) {
  const all = await read(); all[name] = snapshot;
  await chrome.storage.local.set({ [KEY]: all });
}
function validate(s) {
  if (!s || (s.version !== undefined && s.version !== 1) || !Array.isArray(s.tabs) || (s.groups !== undefined && !Array.isArray(s.groups)) ||
      s.tabs.some(t => !t || typeof t.url !== 'string' || !/^(https?:|file:|chrome:|about:)/.test(t.url))) {
    throw new Error('This session contains invalid tab data');
  }
  for (const g of s.groups || []) {
    if (!g || typeof g.title !== 'string' || !['grey','blue','red','yellow','green','pink','purple','cyan','orange'].includes(g.color)) throw new Error('This session contains invalid group data');
  }
  return s;
}
async function snapshot(id) {
  const raw = (await orderedTabs(id)).filter(t => t.url && !t.url.startsWith('chrome://newtab') && !t.url.startsWith('chrome-extension://'));
  const tabs = raw.map(t => ({ url: t.url, pinned: !!t.pinned, groupId: t.groupId !== -1 ? t.groupId : null }));
  const live = await chrome.tabGroups.query({ windowId: id });
  const groups = [...new Set(tabs.map(t => t.groupId).filter(id => id != null))].map(id => {
    const g = live.find(g => g.id === id);
    return { id, title: g?.title || '', color: g?.color || 'grey', collapsed: !!g?.collapsed };
  });
  return { version: 1, savedAt: Date.now(), tabs, groups };
}
async function owner(name) {
  for (const [id, n] of names) if (n === name) {
    try { await chrome.windows.get(id); return id; }
    catch { await track(id, null); }
  }
  return null;
}
async function save(tab, name) {
  const chosen = name || names.get(tab.windowId);
  if (!chosen) return { error: 'usage: save <name>' };
  const finalName = validName(chosen);
  const existing = await owner(finalName);
  if (existing != null && existing !== tab.windowId) return { error: `session "${finalName}" is already running in another window` };
  const revision = revisions.get(tab.windowId) || 0;
  const s = await snapshot(tab.windowId);
  await write(finalName, s);
  await track(tab.windowId, finalName);
  await status(tab.windowId);
  if ((revisions.get(tab.windowId) || 0) !== revision) schedule(tab.windowId);
  return { ok: true, toast: `saved "${finalName}" (${s.tabs.length})` };
}
export function saveSession(tab, name) { return operation(tab, () => save(tab, name), name); }
export function getSessionName(tab) { return serial(() => ({ ok: true, name: names.get(tab.windowId) || null })); }
export function getSaveStatus(tab) { return serial(() => ({ ok: true, ...(statuses.get(tab.windowId) || {}), name: names.get(tab.windowId) || null })); }
export function retrySave(tab) { return operation(tab, () => save(tab, statuses.get(tab.windowId)?.pendingName || names.get(tab.windowId)), () => statuses.get(tab.windowId)?.pendingName); }

async function replace(tab, name, s, fresh) {
  const id = tab.windowId;
  const previous = names.get(id);
  cancel(id);
  transitioning.add(id);
  const created = [];
  let removedOriginals = false;
  let backedUp = false;
  let originalActive;
  try {
    const backup = await snapshot(id);
    if (previous) await write(previous, backup);
    // Durable recovery remains available even for an unnamed source window.
    const stored = await chrome.storage.local.get(RECOVERY);
    await chrome.storage.local.set({ [RECOVERY]: { ...(stored[RECOVERY] || {}), [id]: { ...backup, name: previous || 'Unnamed window' } } });
    backedUp = true;
    await journal(id, true);
    const old = await orderedTabs(id);
    originalActive = old.find(t => t.active)?.id;
    for (const [i, t] of (s.tabs.length ? s.tabs : [{}]).entries()) {
      const added = await chrome.tabs.create({ windowId: id, ...(t.url ? {url:t.url} : {}), pinned: !!t.pinned, active: i === 0 });
      created.push(added.id);
    }
    for (const g of s.groups || []) {
      const members = s.tabs.flatMap((t, i) => t.groupId === g.id ? [created[i]] : []);
      if (!members.length) continue;
      const groupId = await chrome.tabs.group({ tabIds: members });
      await chrome.tabGroups.update(groupId, { title:g.title, color:g.color, collapsed:!!g.collapsed });
    }
    if (fresh) await write(name, s);
    // Persist the new owner before destructive work; failure leaves originals open.
    await track(id, name);
    if (old.length) { removedOriginals = true; await chrome.tabs.remove(old.map(t => t.id)); }
    await journal(id, false);
    await status(id);
    return { ok: true, toast: fresh ? `session "${name}" started — autosaving as you go` : s.tabs.length ? `restored "${name}"` : `"${name}" is empty — starting fresh` };
  } catch (e) {
    let rolledBack = !removedOriginals;
    if (rolledBack) {
      try {
        if (created.length) await chrome.tabs.remove(created);
        if (originalActive != null) await chrome.tabs.update(originalActive, {active:true});
        await track(id, previous);
        await journal(id, false);
      } catch (rollbackError) {
        console.error('Session rollback failed', rollbackError);
        rolledBack = false;
      }
    }
    if (!rolledBack) {
      // Quarantine in memory even if storage is failing. The durable transition
      // marker repeats this protection after a worker restart.
      names.delete(id);
      await track(id, null).catch(console.error);
    }
    throw new Error(`${e.message}${backedUp ? '. Original window snapshot is available in Recovery.' : '. Original tabs were kept open.'}`);
  } finally { transitioning.delete(id); cancel(id); }
}
export function newSession(tab, name) {
  return operation(tab, async () => {
    if (!name) return { error: 'usage: session <name>' };
    name = validName(name);
    const existing = await owner(name);
    if (existing != null) {
      await chrome.windows.update(existing, { focused: true });
      return { ok:true, toast:`session "${name}" already running — switched to it` };
    }
    if (Object.hasOwn(await read(), name)) return { error:`session "${name}" already saved — use :restore ${name} or :kill ${name} first` };
    return replace(tab, name, { version:1, savedAt:Date.now(), tabs:[], groups:[] }, true);
  });
}
export function restoreSession(tab, name) {
  return operation(tab, async () => {
    const all = await read();
    if (!Object.hasOwn(all, name)) return { error:'empty or missing session' };
    const s = validate(all[name]);
    const existing = await owner(name);
    if (existing != null) {
      await chrome.windows.update(existing, { focused:true });
      return { ok:true, toast:`"${name}" already open — switched to it` };
    }
    return replace(tab, name, s, false);
  });
}
export function detach(tab, name) {
  return operation(tab, async () => {
    const result = await save(tab, name);
    if (result.error) return result;
    const previous = names.get(tab.windowId);
    transitioning.add(tab.windowId);
    try {
      await track(tab.windowId, null);
      await chrome.windows.remove(tab.windowId);
      statuses.delete(tab.windowId);
      await persistStatus();
      return { ok:true };
    } catch (e) { await track(tab.windowId, previous); throw e; }
    finally { transitioning.delete(tab.windowId); }
  });
}
export function listSessions() {
  return serial(async () => ({ ok:true, sessions:Object.entries(await read()).map(([name,s]) => ({name,count:Array.isArray(s?.tabs)?s.tabs.length:0,savedAt:s?.savedAt || 0})).sort((a,b)=>b.savedAt-a.savedAt) }));
}
export function listRecovery() {
  return serial(async () => {
    const stored = await chrome.storage.local.get(RECOVERY);
    return { ok:true, recoveries:Object.entries(stored[RECOVERY] || {}).map(([id,s]) => ({id,name:s?.name || 'Recovery',count:Array.isArray(s?.tabs)?s.tabs.length:0,savedAt:s?.savedAt || 0})).sort((a,b)=>b.savedAt-a.savedAt) };
  });
}
export function restoreRecovery(tab, id) {
  return operation(tab, async () => {
    const stored = await chrome.storage.local.get(RECOVERY);
    const s = validate(stored[RECOVERY]?.[id]);
    return replace(tab, `Recovered ${Date.now()}-${crypto.randomUUID().slice(0,8)}`, s, true);
  });
}
async function remove(name) {
  const all = await read(); delete all[name];
  await chrome.storage.local.set({ [KEY]:all });
  for (const [id,n] of names) if (n === name) { await track(id,null); await status(id); }
  return { ok:true, toast:`deleted "${name}"` };
}
export function deleteSession(name) { return serial(() => remove(name)); }
function schedule(id) {
  revisions.set(id, (revisions.get(id) || 0) + 1);
  if (transitioning.has(id)) return;
  return sessionNamesReady.then(() => {
    if (!names.has(id) || transitioning.has(id)) return;
    cancel(id);
    const expected = names.get(id);
    timers.set(id,setTimeout(() => {
      timers.delete(id);
      operation({windowId:id}, () => names.get(id) === expected ? save({windowId:id}) : undefined).catch(console.error);
    },600));
  });
}
chrome.windows.onRemoved.addListener(id => {
  cancel(id);
  if (transitioning.has(id)) return;
  return serial(async () => {
    const name = names.get(id);
    if (name) await remove(name);
    await track(id,null);
    statuses.delete(id);
    await persistStatus();
  }).catch(e => status(id, e.message).catch(console.error));
});
chrome.tabs.onCreated.addListener(t => schedule(t.windowId));
chrome.tabs.onRemoved.addListener((_,info) => { if (!info.isWindowClosing) return schedule(info.windowId); });
chrome.tabs.onUpdated.addListener((_,c,t) => { if (c.url !== undefined || c.pinned !== undefined || c.groupId !== undefined) return schedule(t.windowId); });
chrome.tabs.onMoved.addListener((_,i) => schedule(i.windowId));
chrome.tabs.onAttached.addListener((_,i) => schedule(i.newWindowId));
chrome.tabs.onDetached.addListener((_,i) => schedule(i.oldWindowId));
for (const event of ['onUpdated','onCreated','onMoved','onRemoved']) chrome.tabGroups[event].addListener(g => schedule(g.windowId));
