// The prefix-chord / command-mode state machine: recognizes the prefix,
// dispatches the following key through CMDS, and hands off to copy-mode when
// active. This is the top-level keydown entry point, wired up in main.js.
import { config } from "./config.js";
import { mode, activeOverlay, setMode } from "./state.js";
import { showStatus, hideStatus, idleStatus } from "./ui/status.js";
import { send } from "./messaging.js";
import { CMDS } from "./keymap.js";
import { handleCopyKey } from "./copy-mode.js";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);

let cmdTimer = null;

function matchesPrefix(e) {
  return (
    !!e.ctrlKey === !!config.prefix.ctrl &&
    !!e.altKey === !!config.prefix.alt &&
    !!e.shiftKey === !!config.prefix.shift &&
    e.key.toLowerCase() === config.prefix.key.toLowerCase()
  );
}

export function onKeyDown(e) {
  if (activeOverlay) return; // overlay owns its input
  if (mode === "command") return handleCommandKey(e);
  if (mode === "copy") return handleCopyKey(e);
  if (matchesPrefix(e)) {
    e.preventDefault();
    e.stopPropagation();
    enterCommand();
  }
}

function enterCommand() {
  setMode("command");
  showStatus("PREFIX  ·  c n p x  g G t S B  N s d :  [  ?");
  resetTimer();
}

function exitCommand() {
  setMode("normal");
  clearTimeout(cmdTimer);
  if (config.alwaysShowStatus) showStatus(idleStatus());
  else hideStatus();
}

function resetTimer() {
  clearTimeout(cmdTimer);
  cmdTimer = setTimeout(exitCommand, config.timeoutMs);
}

function handleCommandKey(e) {
  if (MODIFIER_KEYS.has(e.key)) {
    // A bare modifier keydown, e.g. Shift on its way down to type `G`.
    // Don't treat it as "unknown command" — just keep waiting for the real key.
    e.preventDefault();
    e.stopPropagation();
    resetTimer();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape" || e.key === "Enter" || (e.ctrlKey && e.key === "c")) {
    return exitCommand();
  }
  if (/^[1-9]$/.test(e.key)) {
    send({ type: "select-tab", index: parseInt(e.key, 10) });
    return exitCommand();
  }
  const entry = CMDS[e.key];
  if (entry) {
    entry.run();
    if (entry.stays) clearTimeout(cmdTimer);
    else exitCommand();
  } else {
    exitCommand();
  }
}
