// tabmux — background service worker entry point.
// Routes messages from the content script's modal command layer to the
// tabs/groups/sessions modules that actually call the chrome.* APIs.
import { newTab, cycleTab, selectTab, lastTab } from "./tabs.js";
import {
  createGroup, cycleGroup, addToGroupByName, addTabToGroupId, removeFromGroup,
  listGroups, focusGroup, toggleGroupCollapse, renameGroup, closeGroup
} from "./groups.js";
import { newSession, getSessionName, saveSession, detach, listSessions, restoreSession, deleteSession, sessionNamesReady, getSaveStatus, retrySave, listRecovery, restoreRecovery } from "./sessions.js";

import { CONFIG_KEY, normalizeConfig } from '../shared/config.js';

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
storageReady.catch(console.error);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[CONFIG_KEY]) return;
  chrome.tabs.query({}).then(tabs => Promise.all(tabs.map(tab =>
    chrome.tabs.sendMessage(tab.id, { type:'config-updated', config:normalizeConfig(changes[CONFIG_KEY].newValue) }).catch(() => {})
  ))).catch(console.error);
});

// Browser tab activation is authoritative even when a page's visibility/blur
// events are delayed (for example in a background or automated window).
chrome.tabs.onActivated.addListener(({windowId}) => {
  chrome.tabs.query({windowId}).then(tabs => Promise.all(tabs.map(tab =>
    chrome.tabs.sendMessage(tab.id, {type:'reset-mode'}).catch(() => {})
  ))).catch(console.error);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id === chrome.runtime.id && msg?.type === 'save-status') return;
  handle(msg, sender)
    .then((r) => sendResponse(r || { ok: true }))
    .catch((err) => sendResponse({ error: String(err && err.message || err) }));
  return true; // keep the channel open for the async response
});

export async function handle(msg, sender) {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') throw new Error('Invalid extension request');
  if (msg.name !== undefined && (typeof msg.name !== 'string' || msg.name.length > 200)) throw new Error('Invalid session name');
  if (msg.title !== undefined && (typeof msg.title !== 'string' || msg.title.length > 200)) throw new Error('Invalid group title');
  if (msg.groupId !== undefined && (!Number.isInteger(msg.groupId) || msg.groupId < 0)) throw new Error('Invalid group');
  if (msg.replace !== undefined && typeof msg.replace !== 'boolean') throw new Error('Invalid replace flag');
  if (msg.type === 'select-tab' && (!Number.isInteger(msg.index) || msg.index < 1 || msg.index > 9)) throw new Error('Invalid tab index');
  const named = ['new-session','restore-session','delete-session','group-add','group-create'];
  if (named.includes(msg.type) && (typeof msg.name !== 'string' || !msg.name.trim())) throw new Error('A name is required');
  const grouped = ['group-add-to','focus-group','toggle-group-collapse','rename-group','close-group'];
  if (grouped.includes(msg.type) && !Number.isInteger(msg.groupId)) throw new Error('A group is required');
  if (sender.tab && sender.frameId !== 0) throw new Error('Commands must come from the top-level page');
  await storageReady;
  if (msg.type === 'get-config') return { ok:true, config:normalizeConfig((await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY]) };
  await sessionNamesReady; // session-name tracking must be loaded before anything below reads it
  let tab = sender.tab;
  if (!tab) {
    if (sender.url !== chrome.runtime.getURL('popup.html')) throw new Error('This command requires a tab');
    if (!Number.isInteger(msg.tabId)) throw new Error('No target tab');
    tab = await chrome.tabs.get(msg.tabId);
  }
  if (msg.groupId !== undefined) {
    const group = await chrome.tabGroups.get(msg.groupId);
    if (group.windowId !== tab.windowId) throw new Error('Group belongs to another window');
  }
  switch (msg.type) {
    case 'get-save-status': return {ok:true, status:await getSaveStatus(tab)};
    case 'retry-save': return retrySave(tab);
    case 'list-recovery': return listRecovery();
    case 'restore-recovery':
      if (typeof msg.recoveryId !== 'string' || !/^\d+$/.test(msg.recoveryId)) throw new Error('Invalid recovery');
      return restoreRecovery(tab, msg.recoveryId);
    case "new-tab":
      if (tab) return newTab(tab);
      await chrome.tabs.create({});
      return { ok: true, toast: "new tab" };
    case "close-tab":   if (tab) await chrome.tabs.remove(tab.id); return { ok: true };
    case "next-tab":    return cycleTab(tab, +1);
    case "prev-tab":    return cycleTab(tab, -1);
    case "select-tab":  return selectTab(tab, msg.index);
    case "last-tab":    return lastTab(tab);
    case "detach":      return detach(tab, msg.name);
    case "new-session": return newSession(tab, msg.name, msg.replace);
    case "get-session-name": return getSessionName(tab);
    case "save-session":return saveSession(tab, msg.name);
    case "list-sessions": return listSessions();
    case "restore-session": return restoreSession(tab, msg.name, msg.replace);
    case "delete-session":  return deleteSession(msg.name);
    case "group-next":  return cycleGroup(tab, +1);
    case "group-prev":  return cycleGroup(tab, -1);
    case "group-create": return createGroup(tab, msg.name);
    case "group-add":   return addToGroupByName(tab, msg.name);
    case "group-add-to":return addTabToGroupId(tab, msg.groupId);
    case "group-remove":return removeFromGroup(tab);
    case "list-groups": return listGroups(tab);
    case "focus-group": return focusGroup(tab, msg.groupId);
    case "toggle-group-collapse": return toggleGroupCollapse(msg.groupId);
    case "rename-group":return renameGroup(msg.groupId, msg.title);
    case "close-group": return closeGroup(tab, msg.groupId);
    default: return { error: "unknown command: " + msg.type };
  }
}
