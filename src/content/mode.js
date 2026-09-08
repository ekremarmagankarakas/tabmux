// The prefix-chord / command-mode state machine: recognizes the prefix,
// dispatches the following key through CMDS, and hands off to copy-mode when
// active. This is the top-level keydown entry point, wired up in main.js.
import { trustedKey } from './input.js';
import { closeOverlay } from './ui/overlay.js';
import { config } from "./config.js";
import { mode, activeOverlay, setMode, invalidateInteraction } from "./state.js";
import { showStatus, hideStatus, idleStatus, commandStatus } from "./ui/status.js";
import { resolveCommand } from "./keymap.js";
import { handleCopyKey, resetCopyTarget } from "./copy-mode.js";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);

let cmdTimer = null;

function matchesPrefix(e) {
  return (
    !!e.metaKey === !!config.prefix.meta &&
    !!e.ctrlKey === !!config.prefix.ctrl &&
    !!e.altKey === !!config.prefix.alt &&
    !!e.shiftKey === !!config.prefix.shift &&
    e.key.toLowerCase() === config.prefix.key.toLowerCase()
  );
}

export function onKeyDown(e) {
  if (!trustedKey(e)) return;
  if (e.repeat && mode !== 'copy') {
    if (mode === 'command' || matchesPrefix(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    return;
  }
  if (activeOverlay) return; // overlay owns its input
  if (mode === "command") return handleCommandKey(e);
  if (mode === "copy") return handleCopyKey(e);
  if (matchesPrefix(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    enterCommand();
  }
}

function enterCommand() {
  invalidateInteraction();
  setMode("command");
  showStatus(commandStatus());
  resetTimer();
}

function exitCommand() {
  invalidateInteraction();
  setMode("normal");
  clearTimeout(cmdTimer);
  if (config.alwaysShowStatus) showStatus(idleStatus());
  else hideStatus();
}

function resetTimer() {
  clearTimeout(cmdTimer);
  cmdTimer = setTimeout(exitCommand, config.timeoutMs);
}

export function resetTransientMode() {
  invalidateInteraction();
  resetCopyTarget();
  closeOverlay(false);
  exitCommand();
}

function handleCommandKey(e) {
  if (MODIFIER_KEYS.has(e.key)) {
    // A bare modifier keydown, e.g. Shift on its way down to type `G`.
    // Don't treat it as "unknown command" — just keep waiting for the real key.
    e.preventDefault();
    e.stopImmediatePropagation();
    resetTimer();
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === "Escape" || e.key === "Enter" || (e.ctrlKey && e.key === "c")) {
    return exitCommand();
  }
  if (e.metaKey || e.altKey || e.ctrlKey) return exitCommand();
  const entry = resolveCommand(e.key);
  if (entry) {
    const result = entry.run();
    if (result?.catch) result.catch(() => resetTransientMode());
    if (entry.stays) clearTimeout(cmdTimer);
    else exitCommand();
  } else {
    exitCommand();
  }
}
