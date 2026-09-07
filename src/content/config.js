// User-configurable settings (prefix chord, timeout, status bar), loaded from
// chrome.storage.local and kept live via storage.onChanged. `config` is a
// single mutable object — importers keep one reference to it and always see
// the current values (its fields are updated in place, never reassigned).
export const DEFAULTS = {
  prefix: { ctrl: true, alt: false, shift: false, key: "b" }, // tmux-style Ctrl-b
  timeoutMs: 2500,        // auto-leave command mode after inactivity
  alwaysShowStatus: false // keep a tmux-like status bar visible at all times
};

export const config = { ...DEFAULTS, prefix: { ...DEFAULTS.prefix } };

const STORAGE_KEY = "tabmux:config";

// Loads the saved config, calls onReady, then keeps `config` in sync with
// later changes (e.g. from the options page) for the lifetime of the page.
export function initConfig(onReady) {
  chrome.storage.local.get(STORAGE_KEY).then((s) => {
    if (s[STORAGE_KEY]) Object.assign(config, s[STORAGE_KEY]);
    onReady();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) Object.assign(config, changes[STORAGE_KEY].newValue);
  });
}
