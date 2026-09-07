// A small, stateful fake of the chrome.* surface tabmux actually uses —
// enough that tests exercise real state transitions (query results, event
// firing, storage round-trips) instead of just asserting "was this called".
// Not a general-purpose chrome mock; only implements what src/ calls
// (see the `grep -rhoE "chrome\.[a-zA-Z]+\.[a-zA-Z]+"` audit this was built
// against).

function makeEvent() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    async _fire(...args) {
      for (const fn of [...listeners]) await fn(...args);
    },
  };
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function createFakeChrome() {
  let nextId = 1;
  const windows = new Map();
  const tabs = new Map();
  const groups = new Map();
  const storageLocal = {};
  const storageSession = {};

  const events = {
    tabsOnActivated: makeEvent(),
    tabsOnCreated: makeEvent(),
    tabsOnRemoved: makeEvent(),
    tabsOnUpdated: makeEvent(),
    tabsOnMoved: makeEvent(),
    tabsOnAttached: makeEvent(),
    tabsOnDetached: makeEvent(),
    tabGroupsOnUpdated: makeEvent(),
    tabGroupsOnCreated: makeEvent(),
    tabGroupsOnMoved: makeEvent(),
    tabGroupsOnRemoved: makeEvent(),
    windowsOnRemoved: makeEvent(),
    storageOnChanged: makeEvent(),
    runtimeOnMessage: makeEvent(),
  };

  const view = (t) => ({ ...t });

  function tabsIn(windowId) {
    return [...tabs.values()].filter((t) => t.windowId === windowId).sort((a, b) => a.index - b.index);
  }
  function reindex(windowId) {
    tabsIn(windowId).forEach((t, i) => { t.index = i; });
  }

  const chrome = {
    tabs: {
      onActivated: events.tabsOnActivated,
      onCreated: events.tabsOnCreated,
      onRemoved: events.tabsOnRemoved,
      onUpdated: events.tabsOnUpdated,
      onMoved: events.tabsOnMoved,
      onAttached: events.tabsOnAttached,
      onDetached: events.tabsOnDetached,

      async query(q = {}) {
        let result = [...tabs.values()];
        if (q.windowId !== undefined) result = result.filter((t) => t.windowId === q.windowId);
        if (q.groupId !== undefined) result = result.filter((t) => t.groupId === q.groupId);
        return result.map(view);
      },

      async create(props = {}) {
        const windowId = props.windowId ?? [...windows.keys()][0];
        const wtabs = tabsIn(windowId);
        const tab = {
          id: nextId++,
          windowId,
          index: wtabs.length,
          url: props.url ?? "chrome://newtab/",
          pinned: !!props.pinned,
          active: props.active !== false,
          groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
        };
        if (tab.active) for (const t of wtabs) t.active = false;
        tabs.set(tab.id, tab);
        await events.tabsOnCreated._fire(view(tab));
        if (tab.active) await events.tabsOnActivated._fire({ tabId: tab.id, windowId });
        return view(tab);
      },

      async update(tabId, props = {}) {
        const t = tabs.get(tabId);
        if (!t) throw new Error(`No tab with id ${tabId}`);
        const changeInfo = {};
        if (props.active) {
          for (const other of tabsIn(t.windowId)) other.active = false;
          t.active = true;
        }
        if (props.pinned !== undefined) { t.pinned = props.pinned; changeInfo.pinned = props.pinned; }
        if (props.url !== undefined) { t.url = props.url; changeInfo.url = props.url; }
        if (Object.keys(changeInfo).length) await events.tabsOnUpdated._fire(t.id, changeInfo, view(t));
        if (props.active) await events.tabsOnActivated._fire({ tabId: t.id, windowId: t.windowId });
        return view(t);
      },

      async remove(tabIdOrIds) {
        for (const id of Array.isArray(tabIdOrIds) ? tabIdOrIds : [tabIdOrIds]) {
          const t = tabs.get(id);
          if (!t) continue;
          const { windowId } = t;
          tabs.delete(id);
          reindex(windowId);
          const isWindowClosing = tabsIn(windowId).length === 0;
          await events.tabsOnRemoved._fire(id, { windowId, isWindowClosing });
          if (isWindowClosing && windows.has(windowId)) {
            windows.delete(windowId);
            await events.windowsOnRemoved._fire(windowId);
          }
        }
      },

      async group({ tabIds, groupId }) {
        const windowId = tabs.get(tabIds[0])?.windowId;
        let gid = groupId;
        let created = false;
        if (gid == null) {
          gid = nextId++;
          groups.set(gid, { id: gid, windowId, title: "", color: "grey", collapsed: false });
          created = true;
        }
        for (const id of tabIds) {
          const t = tabs.get(id);
          if (!t) continue;
          t.groupId = gid;
          await events.tabsOnUpdated._fire(id, { groupId: gid }, view(t));
        }
        await events[created ? "tabGroupsOnCreated" : "tabGroupsOnUpdated"]._fire(view(groups.get(gid)));
        return gid;
      },

      async ungroup(tabIdOrIds) {
        for (const id of Array.isArray(tabIdOrIds) ? tabIdOrIds : [tabIdOrIds]) {
          const t = tabs.get(id);
          if (!t) continue;
          t.groupId = chrome.tabGroups.TAB_GROUP_ID_NONE;
          await events.tabsOnUpdated._fire(id, { groupId: chrome.tabGroups.TAB_GROUP_ID_NONE }, view(t));
        }
      },
    },

    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      onUpdated: events.tabGroupsOnUpdated,
      onCreated: events.tabGroupsOnCreated,
      onMoved: events.tabGroupsOnMoved,
      onRemoved: events.tabGroupsOnRemoved,

      async query(q = {}) {
        let result = [...groups.values()];
        if (q.windowId !== undefined) result = result.filter((g) => g.windowId === q.windowId);
        return result.map(view);
      },
      async get(groupId) {
        const g = groups.get(groupId);
        if (!g) throw new Error(`No group with id ${groupId}`);
        return view(g);
      },
      async update(groupId, props = {}) {
        const g = groups.get(groupId);
        if (!g) throw new Error(`No group with id ${groupId}`);
        Object.assign(g, props);
        await events.tabGroupsOnUpdated._fire(view(g));
        return view(g);
      },
    },

    windows: {
      onRemoved: events.windowsOnRemoved,
      async get(windowId) {
        const w = windows.get(windowId);
        if (!w) throw new Error(`No window with id ${windowId}`);
        return view(w);
      },
      async update(windowId, props = {}) {
        const w = windows.get(windowId);
        if (!w) throw new Error(`No window with id ${windowId}`);
        Object.assign(w, props);
        return view(w);
      },
      async remove(windowId) {
        if (!windows.has(windowId)) throw new Error(`No window with id ${windowId}`);
        for (const t of tabsIn(windowId)) tabs.delete(t.id);
        for (const g of [...groups.values()]) if (g.windowId === windowId) groups.delete(g.id);
        windows.delete(windowId);
        await events.windowsOnRemoved._fire(windowId);
      },
      async create(props = {}) {
        const windowId = nextId++;
        windows.set(windowId, { id: windowId, type: "normal", state: "normal", focused: !!props.focused });
        const urls = props.url ? (Array.isArray(props.url) ? props.url : [props.url]) : ["chrome://newtab/"];
        const created = urls.map((url, i) => {
          const tab = { id: nextId++, windowId, index: i, url, pinned: false, active: i === 0, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE };
          tabs.set(tab.id, tab);
          return view(tab);
        });
        return { id: windowId, tabs: created };
      },
    },

    storage: {
      local: {
        async get(key) { return key in storageLocal ? { [key]: clone(storageLocal[key]) } : {}; },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: clone(storageLocal[k]), newValue: clone(v) };
            storageLocal[k] = clone(v);
          }
          await events.storageOnChanged._fire(changes, "local");
        },
      },
      session: {
        async get(key) { return key in storageSession ? { [key]: clone(storageSession[key]) } : {}; },
        async set(obj) { for (const [k, v] of Object.entries(obj)) storageSession[k] = clone(v); },
      },
      onChanged: events.storageOnChanged,
    },

    runtime: {
      lastError: undefined,
      onMessage: events.runtimeOnMessage,
      sendMessage() {}, // overridden per-test where a real response is needed
    },
  };

  return {
    chrome,
    // --- test-only seeding/inspection helpers, not part of the chrome API ---
    seedWindow(tabSpecs = [{}]) {
      const windowId = nextId++;
      windows.set(windowId, { id: windowId, type: "normal", state: "normal", focused: false });
      const created = tabSpecs.map((spec, i) => {
        const tab = {
          id: nextId++,
          windowId,
          index: i,
          url: spec.url ?? `https://example.com/${i}`,
          pinned: !!spec.pinned,
          active: spec.active ?? i === 0,
          groupId: spec.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE,
        };
        tabs.set(tab.id, tab);
        return view(tab);
      });
      return { windowId, tabs: created };
    },
    addGroup(windowId, { title = "", color = "grey", collapsed = false } = {}) {
      const id = nextId++;
      groups.set(id, { id, windowId, title, color, collapsed });
      return id;
    },
    getTab(id) { return tabs.has(id) ? view(tabs.get(id)) : undefined; },
    getWindow(id) { return windows.has(id) ? view(windows.get(id)) : undefined; },
    allTabs() { return [...tabs.values()].map(view); },
    allWindows() { return [...windows.values()].map(view); },
    allGroups() { return [...groups.values()].map(view); },
    storageLocalRaw() { return storageLocal; },
    storageSessionRaw() { return storageSession; },
  };
}
