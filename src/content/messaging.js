import { flash, showFailure, clearFailure } from './ui/status.js';
let invalidated = false;
export function sendAsync(msg) {
  return new Promise(resolve => {
    if (invalidated) { resolve({ error:'tabmux was updated — refresh this page' }); return; }
    let finished = false;
    const finish = res => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      const result = res || { error:'No response from tabmux' };
      if (result.error) showFailure(result.error, ['save-session','retry-save','get-save-status','get-config','list-sessions','list-groups'].includes(msg.type) ? () => send(msg) : undefined);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ error:'tabmux did not respond. Open the toolbar picker to check the result before retrying.' }), 30000);
    try {
      chrome.runtime.sendMessage(msg, res => finish(chrome.runtime.lastError ? {error:chrome.runtime.lastError.message} : res));
    } catch (error) {
      invalidated = /context invalidated/i.test(error.message);
      finish({error:invalidated ? 'tabmux was updated — refresh this page' : error.message});
    }
  });
}
export function send(msg) {
  return sendAsync(msg).then(res => { if (!res.error && res.toast) flash(res.toast); return res; });
}
export function displaySaveStatus(value) {
  if (value.error) showFailure(`Not saved: ${value.error}`, value.name || value.pendingName ? () => send({type:'retry-save'}) : undefined);
  else clearFailure();
}
export function initSaveStatus() {
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id === chrome.runtime.id && msg.type === 'save-status') displaySaveStatus(msg);
  });
  sendAsync({type:'get-save-status'}).then(value => { if (value.status?.error) displaySaveStatus(value.status); });
}
