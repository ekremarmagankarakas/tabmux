import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('../../../src/content/messaging.js', () => ({ sendAsync:vi.fn(), send:vi.fn() }));
import { sendAsync } from '../../../src/content/messaging.js';
import { openSessionPicker } from '../../../src/content/ui/session-picker.js';
import { openGroupPicker } from '../../../src/content/ui/group-picker.js';
import { closeOverlay } from '../../../src/content/ui/overlay.js';
import { activeOverlay } from '../../../src/content/state.js';
import { resetTransientMode } from '../../../src/content/mode.js';
const key = (key,isTrusted=true) => ({key,isTrusted,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()});
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { closeOverlay(); vi.clearAllMocks(); });
it('keeps the deletion target stable while waiting for the background', async () => {
  let finish;
  sendAsync.mockResolvedValueOnce({sessions:[{name:'first',count:1,savedAt:0},{name:'second',count:1,savedAt:0}]});
  sendAsync.mockImplementationOnce(() => new Promise(resolve => { finish=resolve; }));
  await openSessionPicker();
  activeOverlay.handler(key('d')); activeOverlay.handler(key('j')); activeOverlay.handler(key('d'));
  expect(sendAsync).toHaveBeenCalledTimes(2);
  finish({ok:true}); await tick();
  expect(activeOverlay.el.querySelectorAll('.row')).toHaveLength(1);
  expect(activeOverlay.el.querySelector('.row').textContent).toContain('second');
});
it('does not remove a row when deletion fails', async () => {
  sendAsync.mockResolvedValueOnce({sessions:[{name:'first',count:1,savedAt:0}]}).mockResolvedValueOnce({error:'storage failed'});
  await openSessionPicker(); activeOverlay.handler(key('d')); await tick();
  expect(activeOverlay.el.querySelectorAll('.row')).toHaveLength(1);
});
it('rejects synthetic picker actions', async () => {
  sendAsync.mockResolvedValueOnce({sessions:[{name:'first',count:1,savedAt:0}]});
  await openSessionPicker(); activeOverlay.handler(key('d',false));
  expect(sendAsync).toHaveBeenCalledTimes(1);
});
it('does not reopen a delayed picker after focus is reset', async () => {
  let finish;
  sendAsync.mockImplementationOnce(() => new Promise(resolve => { finish=resolve; }));
  const opening = openSessionPicker(); resetTransientMode();
  finish({sessions:[]}); await opening;
  expect(activeOverlay).toBeNull();
});
it('keeps a group row intact when closing it fails', async () => {
  sendAsync.mockResolvedValueOnce({groups:[{id:1,title:'work',color:'grey',count:2}]}).mockResolvedValueOnce({error:'group failed'});
  await openGroupPicker(); activeOverlay.handler(key('x')); await tick();
  expect(activeOverlay.el.querySelectorAll('.row')).toHaveLength(1);
});
