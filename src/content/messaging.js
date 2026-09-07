// Talking to the background service worker, which does all the actual
// chrome.tabs / chrome.tabGroups / chrome.windows / chrome.storage work.
import { flash } from "./ui/status.js";

// Once the extension is reloaded/updated, any tab that was already open is
// still running this old content script instance, whose connection back to
// the extension is dead. chrome.runtime.sendMessage throws synchronously in
// that case (not via the usual chrome.runtime.lastError callback path), so
// it has to be try/caught rather than just checked for after the fact.
// There's nothing to recover — only a page refresh fetches the current
// script — so just say so once and stop trying.
let contextInvalidated = false;

function warnInvalidatedOnce() {
  if (contextInvalidated) return;
  contextInvalidated = true;
  flash("⚠ tabmux was updated — refresh this page");
}

// Fire-and-forget: shows a toast for the response's toast/error, if any.
export function send(msg) {
  if (contextInvalidated) return;
  try {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.error) flash("⚠ " + res.error);
      else if (res && res.toast) flash(res.toast);
    });
  } catch (_) {
    warnInvalidatedOnce();
  }
}

// Awaitable variant for callers that need the response payload (pickers).
export function sendAsync(msg) {
  if (contextInvalidated) return Promise.resolve({});
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? {} : res));
    } catch (_) {
      warnInvalidatedOnce();
      resolve({});
    }
  });
}
