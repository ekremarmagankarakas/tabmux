import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeChrome } from "../../mocks/chrome.js";

// sessions.js kicks off chrome.storage.session.get(...) and registers several
// chrome.tabs.*/chrome.tabGroups.*/chrome.windows.onRemoved listeners at
// import time, plus holds its own module-level state (sessionNames,
// autoSaveTimers) — so each test needs a genuinely fresh instance bound to
// that test's own fake chrome. vi.resetModules() + a real dynamic import
// written right here (not routed through a shared helper: a relative
// specifier in import() resolves against *this* file's URL).
let fake;
let sessions;

beforeEach(async () => {
  fake = createFakeChrome();
  globalThis.chrome = fake.chrome;
  vi.resetModules();
  sessions = await import("../../../src/background/sessions.js");
  await sessions.sessionNamesReady;
});

afterEach(() => {
  vi.useRealTimers();
});

function storedSessions() {
  return fake.storageLocalRaw()["tabmux:sessions"] || {};
}

describe("saveSession", () => {
  it("requires a name (explicit or remembered)", async () => {
    const { windowId } = fake.seedWindow([{}]);
    const res = await sessions.saveSession({ windowId }, undefined);
    expect(res.error).toMatch(/usage/);
  });

  it("captures urls/pinned, filters blank/new-tab urls, and captures groups", async () => {
    const { windowId, tabs } = fake.seedWindow([
      { url: "https://a.example/", pinned: true },
      { url: "chrome://newtab/" },
      { url: "https://b.example/" },
    ]);
    const groupId = fake.addGroup(windowId, { title: "work", color: "blue", collapsed: true });
    await fake.chrome.tabs.group({ tabIds: [tabs[2].id], groupId });

    const res = await sessions.saveSession({ windowId }, "mysession");
    expect(res.toast).toBe('saved "mysession" (2)');

    const saved = storedSessions().mysession;
    expect(saved.tabs).toHaveLength(2); // the newtab page was filtered out
    expect(saved.tabs[0]).toMatchObject({ url: "https://a.example/", pinned: true, groupId: null });
    expect(saved.tabs[1]).toMatchObject({ url: "https://b.example/", pinned: false, groupId });
    expect(saved.groups).toEqual([{ id: groupId, title: "work", color: "blue", collapsed: true }]);
  });

  it("falls back to the window's remembered session name", async () => {
    const { windowId } = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.saveSession({ windowId }, "named");
    const res = await sessions.saveSession({ windowId }, undefined);
    expect(res.toast).toBe('saved "named" (1)');
  });
});

describe("newSession", () => {
  it("requires a name", async () => {
    const { windowId } = fake.seedWindow([{}]);
    const res = await sessions.newSession({ windowId }, "");
    expect(res.error).toMatch(/usage/);
  });

  it("replaces the invoking window's tabs with a fresh blank one and seeds a save", async () => {
    const { windowId, tabs } = fake.seedWindow([{ url: "https://old.example/" }]);
    const res = await sessions.newSession({ windowId, id: tabs[0].id, groupId: -1 }, "work");
    expect(res.toast).toMatch(/started/);

    const liveTabs = await fake.chrome.tabs.query({ windowId });
    expect(liveTabs).toHaveLength(1);
    expect(liveTabs[0].url).toBe("chrome://newtab/");
    expect(storedSessions().work).toBeTruthy();
    expect(storedSessions().work.tabs).toEqual([]); // blank seed tab, filtered out
  });

  // Regression: newSession used to only check the in-memory "live" map, so a
  // name that existed on disk but wasn't currently open got silently
  // clobbered with an empty snapshot (see conversation bug_004).
  it("refuses to clobber an existing saved session of the same name", async () => {
    const saved = fake.seedWindow([{ url: "https://a.example/" }]);
    // detach: saved, untracked as live, and its window closed — "on disk,
    // not currently open" (saveSession alone would leave it live in this
    // window, which is a different, already-covered case).
    await sessions.detach({ windowId: saved.windowId, id: saved.tabs[0].id }, "work");

    const { windowId, tabs } = fake.seedWindow([{ url: "https://current.example/" }]);
    const res = await sessions.newSession({ windowId, id: tabs[0].id, groupId: -1 }, "work");

    expect(res.error).toMatch(/already saved/);
    expect(storedSessions().work.tabs[0].url).toBe("https://a.example/"); // untouched
    const stillThere = await fake.chrome.tabs.query({ windowId });
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].url).toBe("https://current.example/"); // untouched
  });

  it("switches to an already-live window instead of duplicating it", async () => {
    const live = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.newSession({ windowId: live.windowId, id: live.tabs[0].id, groupId: -1 }, "work");

    const { windowId, tabs } = fake.seedWindow([{ url: "https://b.example/" }]);
    const res = await sessions.newSession({ windowId, id: tabs[0].id, groupId: -1 }, "work");

    expect(res.toast).toMatch(/already running/);
    expect(fake.getWindow(live.windowId).focused).toBe(true);
    const untouched = await fake.chrome.tabs.query({ windowId });
    expect(untouched[0].url).toBe("https://b.example/");
  });

  it("flushes a different previous live session on this window before replacing it", async () => {
    const { windowId, tabs } = fake.seedWindow([{ url: "https://old.example/" }]);
    await sessions.saveSession({ windowId }, "old"); // this window is now live as "old"

    await sessions.newSession({ windowId, id: tabs[0].id, groupId: -1 }, "new");

    expect(storedSessions().old.tabs[0].url).toBe("https://old.example/");
    expect(storedSessions().new).toBeTruthy();
  });
});

describe("restoreSession", () => {
  it("errors for a name that was never saved", async () => {
    const { windowId } = fake.seedWindow([{}]);
    const res = await sessions.restoreSession({ windowId }, "ghost");
    expect(res.error).toMatch(/empty or missing/);
  });

  it("replaces the invoking window's tabs and reconstructs groups", async () => {
    const source = fake.seedWindow([
      { url: "https://a.example/" },
      { url: "https://b.example/", pinned: true },
    ]);
    const groupId = fake.addGroup(source.windowId, { title: "docs", color: "red", collapsed: false });
    await fake.chrome.tabs.group({ tabIds: [source.tabs[0].id], groupId });
    // detach so the source window closes and this session is "not live" —
    // otherwise restoreSession's own dedup would just attach to it instead
    // of exercising the tab-recreation path this test is actually after.
    await sessions.detach({ windowId: source.windowId, id: source.tabs[0].id }, "docs-session");

    const target = fake.seedWindow([{ url: "https://stale.example/" }]);
    const res = await sessions.restoreSession({ windowId: target.windowId }, "docs-session");
    expect(res.toast).toBe('restored "docs-session"');

    const liveTabs = await fake.chrome.tabs.query({ windowId: target.windowId });
    expect(liveTabs.map((t) => t.url)).toEqual(["https://a.example/", "https://b.example/"]);
    expect(liveTabs.find((t) => t.url === "https://b.example/").pinned).toBe(true);

    const restoredGroupId = liveTabs.find((t) => t.url === "https://a.example/").groupId;
    expect(restoredGroupId).not.toBe(-1);
    expect(fake.allGroups().find((g) => g.id === restoredGroupId)).toMatchObject({
      title: "docs", color: "red", collapsed: false,
    });
  });

  // Regression: a session saved with zero tabs (e.g. newSession's seed save,
  // if the browser crashed before any real tab was added) used to be
  // rejected by the same "empty or missing" error as a name that never
  // existed at all — leaving an unrestorable, permanently stuck stub
  // (conversation bug_006).
  it("treats a saved-but-empty session as 'start fresh', not an error", async () => {
    const seedWin = fake.seedWindow([{ url: "https://x.example/" }]);
    await sessions.newSession({ windowId: seedWin.windowId, id: seedWin.tabs[0].id, groupId: -1 }, "empty-one");
    // detach it (still empty) so it's "on disk, not live" — see comment above
    await sessions.detach({ windowId: seedWin.windowId, id: seedWin.tabs[0].id }, "empty-one");

    const target = fake.seedWindow([{ url: "https://stale.example/" }]);
    const res = await sessions.restoreSession({ windowId: target.windowId }, "empty-one");
    expect(res.error).toBeUndefined();
    expect(res.toast).toMatch(/starting fresh/);
    expect(await fake.chrome.tabs.query({ windowId: target.windowId })).toHaveLength(1);
  });

  it("attaches to an already-live window instead of duplicating", async () => {
    const source = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.saveSession({ windowId: source.windowId }, "live-one");

    const target = fake.seedWindow([{ url: "https://b.example/" }]);
    const res = await sessions.restoreSession({ windowId: target.windowId }, "live-one");

    expect(res.toast).toMatch(/already open/);
    expect(fake.getWindow(source.windowId).focused).toBe(true);
    const untouched = await fake.chrome.tabs.query({ windowId: target.windowId });
    expect(untouched[0].url).toBe("https://b.example/");
  });
});

describe("detach", () => {
  it("saves, closes the window, and the save survives the close", async () => {
    const { windowId, tabs } = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.detach({ windowId, id: tabs[0].id }, "gone-window");

    expect(fake.getWindow(windowId)).toBeUndefined();
    expect(storedSessions()["gone-window"]).toBeTruthy();
  });
});

describe("deleteSession", () => {
  it("removes the stored session", async () => {
    const { windowId } = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.saveSession({ windowId }, "temp");
    await sessions.deleteSession("temp");
    expect(storedSessions().temp).toBeUndefined();
  });

  // Regression: deleting a session used to leave any window still live for
  // that name tracked in memory, so the very next autosave resurrected the
  // entry by resolving its remembered name right back to the deleted one
  // (conversation bug_001).
  it("untracks any window still live for the deleted name", async () => {
    const { windowId } = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.saveSession({ windowId }, "temp");

    await sessions.deleteSession("temp");
    expect(storedSessions().temp).toBeUndefined();

    vi.useFakeTimers();
    await fake.chrome.tabs.create({ windowId, url: "https://b.example/" });
    await vi.advanceTimersByTimeAsync(700);
    expect(storedSessions().temp).toBeUndefined(); // still gone
  });
});

// Regression: saveSession/deleteSession each did an unlocked read-the-whole-
// blob, mutate, write-it-back on the sessions storage key. With autosave
// debounced per window rather than globally, two live sessions' timers (or a
// save racing a delete) firing close together could each read the same
// snapshot and then each write back their own change, silently clobbering
// the other — exactly the "one window per session" workflow this project
// promotes. Firing two mutations without awaiting between them reproduces
// the interleaving deterministically against the fake's promise-based
// storage; a shared lock around every mutation of the blob is what prevents it.
describe("concurrent session writes", () => {
  it("doesn't lose one session's save to a concurrent save of a different session", async () => {
    const winA = fake.seedWindow([{ url: "https://a.example/" }]);
    const winB = fake.seedWindow([{ url: "https://b.example/" }]);

    await Promise.all([
      sessions.saveSession({ windowId: winA.windowId }, "work"),
      sessions.saveSession({ windowId: winB.windowId }, "personal"),
    ]);

    expect(storedSessions().work?.tabs[0]?.url).toBe("https://a.example/");
    expect(storedSessions().personal?.tabs[0]?.url).toBe("https://b.example/");
  });

  it("doesn't let a concurrent save resurrect a session being deleted at the same time", async () => {
    const win = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.saveSession({ windowId: win.windowId }, "temp");
    const other = fake.seedWindow([{ url: "https://b.example/" }]);

    await Promise.all([
      sessions.deleteSession("temp"),
      sessions.saveSession({ windowId: other.windowId }, "other"),
    ]);

    expect(storedSessions().temp).toBeUndefined();
    expect(storedSessions().other).toBeTruthy();
  });
});

describe("autosave", () => {
  beforeEach(() => vi.useFakeTimers());

  it("debounces and saves a live window's tabs after tab activity", async () => {
    const { windowId } = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.saveSession({ windowId }, "live");

    await fake.chrome.tabs.create({ windowId, url: "https://new.example/" });
    expect(storedSessions().live.tabs).toHaveLength(1); // debounced — not yet

    await vi.advanceTimersByTimeAsync(700);
    expect(storedSessions().live.tabs).toHaveLength(2);
  });

  it("does not autosave a window that isn't live", async () => {
    const { windowId } = fake.seedWindow([{ url: "https://a.example/" }]);
    await fake.chrome.tabs.create({ windowId, url: "https://new.example/" });
    await vi.advanceTimersByTimeAsync(700);
    expect(storedSessions()).toEqual({});
  });

  it("skips the autosave triggered by tabs closing because the window itself is closing", async () => {
    const { windowId, tabs } = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.saveSession({ windowId }, "closing-soon");

    await fake.chrome.tabs.remove(tabs[0].id); // last tab -> window closes too
    await vi.advanceTimersByTimeAsync(700);

    // The window-close path (tested separately) deletes the session; the
    // point here is that no autosave raced it with a bogus empty tab list.
    expect(storedSessions()["closing-soon"]).toBeUndefined();
  });

  // Regression: only chrome.tabs.* events were watched, so renaming a group,
  // recoloring it, or toggling its collapsed state — all chrome.tabGroups.*
  // events — never triggered an autosave (conversation bug_002).
  it("reacts to tab-group rename, not just tab events", async () => {
    const { windowId, tabs } = fake.seedWindow([{ url: "https://a.example/" }]);
    const groupId = fake.addGroup(windowId, { title: "old-name" });
    await fake.chrome.tabs.group({ tabIds: [tabs[0].id], groupId });
    await sessions.saveSession({ windowId }, "live");
    expect(storedSessions().live.groups[0].title).toBe("old-name");

    await fake.chrome.tabGroups.update(groupId, { title: "new-name" });
    await vi.advanceTimersByTimeAsync(700);
    expect(storedSessions().live.groups[0].title).toBe("new-name");
  });

  // Regression: the onUpdated filter only checked url/pinned, so a tab's
  // *membership* changing (prefix B ungrouping it, or prefix S filing it
  // into a different group) went unnoticed whenever that change happened to
  // not also trigger a reposition (onMoved) or alter the group's own
  // properties (tabGroups.onUpdated) — e.g. ungrouping a tab already sitting
  // at its group's edge. The stale membership would then persist and come
  // back on the next restore.
  it("reacts to a tab's group membership changing, not just group properties", async () => {
    const { windowId, tabs } = fake.seedWindow([{ url: "https://a.example/" }]);
    const groupId = fake.addGroup(windowId, { title: "some-group" });
    await fake.chrome.tabs.group({ tabIds: [tabs[0].id], groupId });
    await sessions.saveSession({ windowId }, "live");
    expect(storedSessions().live.tabs[0].groupId).toBe(groupId);

    await fake.chrome.tabs.ungroup([tabs[0].id]);
    await vi.advanceTimersByTimeAsync(700);
    expect(storedSessions().live.tabs[0].groupId).toBeNull();
  });
});

// Regression: sessionNames lived only in a plain in-memory Map, wiped on
// every MV3 service-worker eviction (~30s idle) — so "close all tabs in a
// session" (chrome.windows.onRemoved) silently stopped killing the session
// once the worker had restarted in between. Reloading the module here with
// the *same* fake chrome simulates that restart; chrome.storage.session is
// what's supposed to carry sessionNames across it.
describe("session-death survives a simulated service-worker restart", () => {
  it("chrome.windows.onRemoved still kills the session after the module reloads", async () => {
    const { windowId, tabs } = fake.seedWindow([{ url: "https://a.example/" }]);
    await sessions.saveSession({ windowId }, "durable");
    expect(storedSessions().durable).toBeTruthy();

    vi.resetModules();
    const reloaded = await import("../../../src/background/sessions.js");
    await reloaded.sessionNamesReady;

    await fake.chrome.tabs.remove(tabs[0].id); // closes the window
    expect(storedSessions().durable).toBeUndefined();
  });
});
