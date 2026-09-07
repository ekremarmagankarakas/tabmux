// The command table: single source of truth for what each key does after the
// prefix, whether it stays in command mode (overlays/copy-mode do — they own
// input until the user backs out), and the label shown in the help overlay.
import { send } from "./messaging.js";
import { div, escapeHtml } from "./utils.js";
import { prefixLabel } from "./ui/status.js";
import { openOverlay, closeOverlay } from "./ui/overlay.js";
import { openSessionPicker } from "./ui/session-picker.js";
import { openGroupPicker, openSendToGroupPicker } from "./ui/group-picker.js";
import { openNewSessionPrompt, openDetachPrompt, openCommandPrompt } from "./ui/prompts.js";
import { enterCopyMode } from "./copy-mode.js";

export const CMDS = {
  "c":   { label: "new tab",             run: () => send({ type: "new-tab" }) },
  "x":   { label: "close tab",           run: () => send({ type: "close-tab" }) },
  "n":   { label: "next tab",            run: () => send({ type: "next-tab" }) },
  "p":   { label: "previous tab",        run: () => send({ type: "prev-tab" }) },
  "Tab": { label: "last tab",            run: () => send({ type: "last-tab" }) },
  ";":   { label: "last tab",            run: () => send({ type: "last-tab" }) },
  "g":   { label: "next tab group",      run: () => send({ type: "group-next" }) },
  "G":   { label: "prev tab group",      run: () => send({ type: "group-prev" }) },
  "t":   { label: "tab group picker",    run: openGroupPicker,        stays: true },
  "S":   { label: "send tab to group",   run: openSendToGroupPicker,  stays: true },
  "B":   { label: "break from tab group",run: () => send({ type: "group-remove" }) },
  "s":   { label: "session picker",      run: openSessionPicker,     stays: true },
  "N":   { label: "new session",         run: openNewSessionPrompt, stays: true },
  "d":   { label: "detach (save+close)", run: openDetachPrompt,    stays: true },
  ":":   { label: "command prompt",      run: openCommandPrompt, stays: true },
  "[":   { label: "copy/scroll mode",    run: enterCopyMode,     stays: true },
  "?":   { label: "help",                run: openHelp,          stays: true }
};

export function openHelp() {
  const rows = Object.entries(CMDS)
    .filter(([k]) => !["Tab", ";"].includes(k))
    .map(([k, v]) => `<div class="k">${prefixLabel()} ${escapeHtml(k)}</div><div class="d">${v.label}</div>`)
    .join("");
  const extra = `<div class="k">${prefixLabel()} 1-9</div><div class="d">jump to tab N (within the current group, if any)</div>`;
  const el = div(`<h2>tabmux — keybindings</h2><div class="grid">${rows}${extra}</div>
    <div class="hint">press any key to close</div>`, "panel");
  openOverlay(el, () => closeOverlay());
}
