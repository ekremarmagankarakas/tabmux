import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createFakeChrome } from '../../mocks/chrome.js';
let fake, sessions;
beforeEach(async () => {
  fake = createFakeChrome(); globalThis.chrome = fake.chrome;
  vi.resetModules(); sessions = await import('../../../src/background/sessions.js');
  await sessions.sessionNamesReady;
});
afterEach(() => vi.useRealTimers());
const tab = w => w.tabs[0];
const stored = () => fake.storageLocalRaw()['tabmux:sessions'];
it('rejects a second live owner, including concurrent saves', async () => {
  const a = fake.seedWindow(), b = fake.seedWindow();
  const results = await Promise.all([sessions.saveSession(tab(a),'work'),sessions.saveSession(tab(b),'work')]);
  expect(results[0].ok).toBe(true); expect(results[1].error).toMatch(/another window/);
  await chrome.windows.remove(b.windowId);
  expect(stored().work).toBeTruthy();
});
it.each(['__proto__','constructor','toString'])('round-trips the name %s safely', async name => {
  const w = fake.seedWindow(); await sessions.saveSession(tab(w),name);
  expect((await sessions.listSessions()).sessions.map(s=>s.name)).toContain(name);
  expect(Object.hasOwn(stored(),name)).toBe(true);
});
it('does not detach when no name is available', async () => {
  const w = fake.seedWindow(); expect((await sessions.detach(tab(w))).error).toMatch(/usage/);
  expect(fake.getWindow(w.windowId)).toBeTruthy();
});
it('keeps original tabs when storage fails before replacement', async () => {
  const w = fake.seedWindow([{url:'https://original.example'}]);
  await sessions.saveSession(tab(w),'old');
  vi.spyOn(chrome.storage.local,'set').mockRejectedValue(new Error('disk full'));
  // replace:true — this test is specifically about replace()'s rollback
  // keeping the original tab alive when storage fails; the default (open in
  // a new window) never touches w's own tab, so there'd be nothing to keep.
  await expect(sessions.newSession(tab(w),'new',true)).rejects.toThrow(/disk full/);
  expect(fake.getTab(tab(w).id)).toBeTruthy();
  expect((await sessions.getSaveStatus(tab(w))).error).toMatch(/disk full/);
});
it('keeps originals and rolls back created tabs when group restoration fails', async () => {
  const source = fake.seedWindow(); const group = fake.addGroup(source.windowId);
  await chrome.tabs.group({tabIds:[tab(source).id],groupId:group});
  await sessions.detach(tab(source),'saved');
  const w = fake.seedWindow([{url:'https://original.example'}]);
  vi.spyOn(chrome.tabs,'group').mockRejectedValue(new Error('group failed'));
  // replace:true — this test is specifically about replace()'s rollback/
  // recovery guarantees, which the default (open in a new window, minimize
  // this one) doesn't need: it never touches this window's existing tabs.
  await expect(sessions.restoreSession(tab(w),'saved',true)).rejects.toThrow(/group failed/);
  expect(await chrome.tabs.query({windowId:w.windowId})).toEqual([tab(w)]);
  expect((await sessions.listRecovery()).recoveries).toHaveLength(1);
});
it('suppresses autosave throughout a slow restore', async () => {
  vi.useFakeTimers();
  const source = fake.seedWindow([{url:'https://saved.example'}]); await sessions.detach(tab(source),'saved');
  const w = fake.seedWindow([{url:'https://original.example'}]); await sessions.saveSession(tab(w),'old');
  const create = chrome.tabs.create.bind(chrome.tabs);
  vi.spyOn(chrome.tabs,'create').mockImplementation(async props => {
    const created = await create(props); await vi.advanceTimersByTimeAsync(1000); return created;
  });
  // replace:true — this is specifically about suppressing autosave while w's
  // own tabs are being torn down and rebuilt in place; the default (open in
  // a new window) never touches w's tabs, so there'd be nothing to suppress.
  await sessions.restoreSession(tab(w),'saved',true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(stored().old.tabs.map(t=>t.url)).toEqual(['https://original.example']);
  expect(stored().saved.tabs.map(t=>t.url)).toEqual(['https://saved.example']);
});
it('serializes a save already in flight before deletion', async () => {
  const w = fake.seedWindow(); await sessions.saveSession(tab(w),'work');
  await Promise.all([sessions.saveSession(tab(w)),sessions.deleteSession('work')]);
  expect(Object.hasOwn(stored(),'work')).toBe(false);
  expect((await sessions.getSessionName(tab(w))).name).toBeNull();
});
it('retry clears an autosave failure only after storage succeeds', async () => {
  const log = vi.spyOn(console,'error').mockImplementation(() => {});
  vi.useFakeTimers();
  const w = fake.seedWindow(); await sessions.saveSession(tab(w),'work');
  const spy = vi.spyOn(chrome.storage.local,'set').mockRejectedValue(new Error('disk full'));
  await chrome.tabs.create({windowId:w.windowId,url:'https://new.example'});
  await vi.advanceTimersByTimeAsync(700);
  expect((await sessions.getSaveStatus(tab(w))).error).toMatch(/disk full/);
  spy.mockRestore(); await sessions.retrySave(tab(w));
  expect((await sessions.getSaveStatus(tab(w))).error).toBeNull();
  expect(stored().work.tabs).toHaveLength(2);
  expect(log).toHaveBeenCalled(); log.mockRestore();
});
it('quarantines a window after a worker restart during a switch', async () => {
  const w = fake.seedWindow(); await sessions.saveSession(tab(w),'work');
  await chrome.storage.session.set({'tabmux:transitions':[w.windowId]});
  vi.resetModules(); const restarted = await import('../../../src/background/sessions.js');
  await restarted.sessionNamesReady;
  expect((await restarted.getSessionName(tab(w))).name).toBeNull();
  expect((await restarted.getSaveStatus(tab(w))).error).toMatch(/interrupted/);
  expect(stored().work).toBeTruthy();
});
it('rejects malformed stored data before touching a window', async () => {
  const w = fake.seedWindow(); await chrome.storage.local.set({'tabmux:sessions':{broken:{tabs:[{url:'javascript:alert(1)'}]}}});
  await expect(sessions.restoreSession(tab(w),'broken')).rejects.toThrow(/invalid tab data/);
  expect(fake.getTab(tab(w).id)).toBeTruthy();
});
it('can restore the durable recovery of an unnamed window', async () => {
  // replace:true — durable recovery snapshots are a replace() concern (this
  // window's tabs are about to be destroyed in place); open()'s default never
  // destroys anything, so it never has a recovery snapshot to write.
  const w = fake.seedWindow([{url:'https://original.example'}]); await sessions.newSession(tab(w),'fresh',true);
  const recovery = (await sessions.listRecovery()).recoveries[0];
  await sessions.restoreRecovery({windowId:w.windowId},recovery.id);
  expect((await chrome.tabs.query({windowId:w.windowId}))[0].url).toBe('https://original.example');
});
it('resaves changes that arrive while a snapshot is being written', async () => {
  vi.useFakeTimers();
  const w = fake.seedWindow(); await sessions.saveSession(tab(w),'work');
  const set = chrome.storage.local.set.bind(chrome.storage.local);
  let changed = false;
  vi.spyOn(chrome.storage.local,'set').mockImplementation(async value => {
    if (!changed) { changed=true; await chrome.tabs.create({windowId:w.windowId,url:'https://late.example'}); }
    return set(value);
  });
  await sessions.saveSession(tab(w));
  await vi.advanceTimersByTimeAsync(700);
  expect(stored().work.tabs.map(t=>t.url)).toContain('https://late.example');
});
it('retains a first-save name for retry without assigning ownership prematurely', async () => {
  const w = fake.seedWindow();
  const set = vi.spyOn(chrome.storage.local,'set').mockRejectedValue(new Error('disk full'));
  await expect(sessions.saveSession(tab(w),'work')).rejects.toThrow('disk full');
  expect((await sessions.getSessionName(tab(w))).name).toBeNull();
  set.mockRestore(); await sessions.retrySave(tab(w));
  expect(stored().work).toBeTruthy();
});
it('quarantines a window when rollback itself fails', async () => {
  const log = vi.spyOn(console,'error').mockImplementation(() => {});
  const source = fake.seedWindow(); const group = fake.addGroup(source.windowId);
  await chrome.tabs.group({tabIds:[tab(source).id],groupId:group});
  await sessions.detach(tab(source),'saved');
  const w = fake.seedWindow(); await sessions.saveSession(tab(w),'old');
  vi.spyOn(chrome.tabs,'group').mockRejectedValue(new Error('group failed'));
  vi.spyOn(chrome.tabs,'remove').mockRejectedValue(new Error('rollback failed'));
  // replace:true — see comment on the previous test.
  await expect(sessions.restoreSession(tab(w),'saved',true)).rejects.toThrow(/Recovery/);
  expect((await sessions.getSessionName(tab(w))).name).toBeNull();
  expect(fake.storageSessionRaw()['tabmux:transitions']).toContain(w.windowId);
  expect(stored().old.tabs).toHaveLength(1);
  log.mockRestore();
});
