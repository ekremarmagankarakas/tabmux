import { mode } from './state.js';
import { showStatus, hideStatus, idleStatus } from './ui/status.js';
import { sendAsync } from './messaging.js';
import { DEFAULTS, normalizeConfig } from '../shared/config.js';
export { DEFAULTS };
export const config = normalizeConfig(DEFAULTS);

// New/restore session's Enter-vs-shift+Enter (and bare-verb-vs-`!`) split:
// `modified` is true when the user reached for the modifier (shift held, or
// `!` typed). The *effective* action is config.sessionReplaceDefault flipped
// by that — so the modifier always means "the other one", whichever one the
// configured default currently is.
export function sessionReplace(modified) {
  return config.sessionReplaceDefault ? !modified : modified;
}
export function initConfig(onReady) {
  let revision = 0;
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || msg.type !== 'config-updated') return;
    revision++;
    Object.assign(config, normalizeConfig(msg.config));
    if (mode === 'normal') {
      if (config.alwaysShowStatus) showStatus(idleStatus()); else hideStatus();
    }
  });
  sendAsync({ type:'get-config' }).then(res => {
    if (!revision && res.config) Object.assign(config, normalizeConfig(res.config));
    onReady();
  });
}
