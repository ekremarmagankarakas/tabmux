import { helpCommands, commandForKey, keyLabel } from '../shared/commands.js';
import { config } from './config.js';
// The command table: single source of truth for what each key does after the
// prefix, whether it stays in command mode (overlays/copy-mode do — they own
// input until the user backs out), and the label shown in the help overlay.
import { send } from "./messaging.js";
import { div, escapeHtml } from "./utils.js";
import { prefixLabel } from "./ui/status.js";
import { openOverlay, closeOverlay } from "./ui/overlay.js";
import { openSessionPicker } from "./ui/session-picker.js";
import { openGroupPicker, openSendToGroupPicker } from "./ui/group-picker.js";
import { openNewGroupPrompt, openNewSessionPrompt, openDetachPrompt, openCommandPrompt } from "./ui/prompts.js";
import { enterCopyMode } from "./copy-mode.js";

const ACTIONS = {
  'group-create': openNewGroupPrompt,
  'group-picker': openGroupPicker,
  'send-to-group': openSendToGroupPicker,
  'session-picker': openSessionPicker,
  'new-session': openNewSessionPrompt,
  'detach': openDetachPrompt,
  'command-prompt': openCommandPrompt,
  'copy-mode': enterCopyMode,
  'help': openHelp,
};

export function resolveCommand(key) {
  const command = commandForKey(config.bindings, key);
  if (!command) return null;
  if (ACTIONS[command.id]) return { run: ACTIONS[command.id], stays: true };
  if (command.id.startsWith('select-tab-')) {
    return { run: () => send({ type: 'select-tab', index: Number(command.id.slice(11)) }) };
  }
  return { run: () => send({ type: command.id }) };
}

export function openHelp() {
  const rows = helpCommands(config.bindings).map(command => {
    const keys = command.keys;
    const label = keys.length ? keys.map(key => `${prefixLabel()} ${escapeHtml(keyLabel(key))}`).join(' / ') : 'unbound';
    return `<div class="k">${label}</div><div class="d">${escapeHtml(command.label)}</div>`;
  }).join('');
  const el = div(`<h2>tabmux — keybindings</h2><div class="grid">${rows}</div>
    <div class="hint">tab jumps stay within the current group · edit bindings in Options<br>press any key to close</div>`, 'panel');
  openOverlay(el, () => closeOverlay());
}
