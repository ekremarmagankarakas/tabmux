import { mode } from './state.js';
import { showStatus, hideStatus, idleStatus } from './ui/status.js';
import { sendAsync } from './messaging.js';
import { DEFAULTS, normalizeConfig } from '../shared/config.js';
export { DEFAULTS };
export const config = normalizeConfig(DEFAULTS);
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
