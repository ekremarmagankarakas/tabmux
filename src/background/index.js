// tabmux — background service worker entry point.
// Routes messages from the content script's modal command layer to the
// tabs/groups/sessions modules that actually call the chrome.* APIs.
import { newTab, cycleTab, selectTab, lastTab } from "./tabs.js";
import {
  cycleGroup, addToGroupByName, addTabToGroupId, removeFromGroup,
  listGroups, focusGroup, toggleGroupCollapse, renameGroup, closeGroup
} from "./groups.js";
import { newSession, getSessionName, saveSession, detach, listSessions, restoreSession, deleteSession, sessionNamesReady } from "./sessions.js";

// No default_popup is declared, so a plain click on the toolbar icon would
// otherwise do nothing — send it to Options instead, same destination as the
// existing right-click → Options entry point.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((r) => sendResponse(r || { ok: true }))
    .catch((err) => sendResponse({ error: String(err && err.message || err) }));
  return true; // keep the channel open for the async response
});

async function handle(msg, sender) {
  await sessionNamesReady; // session-name tracking must be loaded before anything below reads it
  const tab = sender.tab; // the tab the command was issued from
  switch (msg.type) {
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
    case "new-session": return newSession(tab, msg.name);
    case "get-session-name": return getSessionName(tab);
    case "save-session":return saveSession(tab, msg.name);
    case "list-sessions": return listSessions();
    case "restore-session": return restoreSession(tab, msg.name);
    case "delete-session":  return deleteSession(msg.name);
    case "group-next":  return cycleGroup(tab, +1);
    case "group-prev":  return cycleGroup(tab, -1);
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
