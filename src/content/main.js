import { rememberScrollTarget } from './copy-mode.js';
import { activeOverlay, mode } from './state.js';
import { initSaveStatus } from './messaging.js';
// tabmux — content script entry point.
// Bootstraps config, then attaches the single top-level keydown listener that
// drives everything else (see mode.js). Bundled by scripts/build.mjs into the
// flat dist/content.js Chrome actually loads.
import { initConfig, config } from "./config.js";
import { showStatus, idleStatus } from "./ui/status.js";
import { onKeyDown, resetTransientMode } from "./mode.js";

initConfig(() => {
  if (config.alwaysShowStatus && mode === "normal") showStatus(idleStatus());
});

window.addEventListener("keydown", onKeyDown, true);

window.addEventListener('blur', resetTransientMode);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetTransientMode(); });

initSaveStatus();

document.addEventListener('focusin', e => {
  if (activeOverlay && !e.composedPath().includes(activeOverlay.el)) resetTransientMode();
  else if (!activeOverlay && mode === 'copy') resetTransientMode();
}, true);

chrome.runtime.onMessage.addListener((msg,sender) => {
  if (sender.id === chrome.runtime.id && msg.type === 'reset-mode') resetTransientMode();
});

window.addEventListener('pointerdown', rememberScrollTarget, true);
