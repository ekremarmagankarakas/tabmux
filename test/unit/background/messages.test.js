import { beforeEach, it, expect, vi } from 'vitest';
import { createFakeChrome } from '../../mocks/chrome.js';
let fake,handle,window;
beforeEach(async () => {
  fake = createFakeChrome(); globalThis.chrome=fake.chrome;
  chrome.runtime.id='tabmux'; chrome.runtime.getURL=path => `chrome-extension://tabmux/${path}`;
  chrome.storage.local.setAccessLevel=vi.fn(async () => {});
  chrome.tabs.sendMessage=vi.fn(async () => {});
  chrome.tabs.get=async id => fake.getTab(id);
  vi.resetModules(); ({handle}=await import('../../../src/background/index.js'));
  window=fake.seedWindow();
});
const sender = () => ({id:'tabmux',frameId:0,tab:window.tabs[0]});
it('rejects requests from other senders and child frames',async () => {
  await expect(handle({type:'close-tab'},{...sender(),id:'other'})).rejects.toThrow(/Invalid/);
  await expect(handle({type:'close-tab'},{...sender(),frameId:1})).rejects.toThrow(/top-level/);
  expect(fake.getTab(window.tabs[0].id)).toBeTruthy();
});
it('validates required names, indices and cross-window groups',async () => {
  await expect(handle({type:'delete-session'},sender())).rejects.toThrow(/name/);
  await expect(handle({type:'select-tab',index:0},sender())).rejects.toThrow(/index/);
  const other=fake.seedWindow(); const groupId=fake.addGroup(other.windowId);
  await expect(handle({type:'close-group',groupId},sender())).rejects.toThrow(/another window/);
});
it('resolves a popup target even on New Tab',async () => {
  await handle({type:'save-session',name:'newtab',tabId:window.tabs[0].id},{id:'tabmux',url:chrome.runtime.getURL('popup.html')});
  expect(fake.storageLocalRaw()['tabmux:sessions'].newtab).toBeTruthy();
});
it('limits direct storage access to trusted extension contexts',async () => {
  expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({accessLevel:'TRUSTED_CONTEXTS'});
});
