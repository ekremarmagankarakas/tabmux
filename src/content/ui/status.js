import { keyLabel } from '../../shared/commands.js';
// The bottom status bar and the transient toast, plus the prefix label they
// both share.
import { config } from "../config.js";
import { escapeHtml } from "../utils.js";
import { ui } from "./shell.js";

let barEl, toastEl, toastTimer;

// Every call site (here and in keymap.js's help overlay) interpolates this
// straight into innerHTML — escape once, here, rather than trusting every
// caller to remember it. config.prefix.key is user-supplied (the options
// page's single-character field has no charset filter beyond lowercasing),
// so a prefix key of `<` or `"` would otherwise be self-inflicted broken
// markup in the user's own status bar/help overlay — not exploitable by
// anyone else, but cheap to just not allow.
export function prefixLabel() {
  const p = config.prefix;
  const m = [];
  if (p.ctrl) m.push("C");
  if (p.alt) m.push("A");
  if (p.shift) m.push("S");
  if (p.meta) m.push("M");
  return escapeHtml(m.concat(p.key).join("-"));
}

export function idleStatus() {
  const help = config.bindings.help?.[0];
  return `[tabmux]  prefix ${prefixLabel()}  ·  ${help ? `${escapeHtml(keyLabel(help))} for keys` : 'bindings in Options'}`;
}

export function commandStatus() {
  const hints = [['new-tab', 'new tab'], ['session-picker', 'sessions'], ['help', 'help']]
    .filter(([id]) => config.bindings[id]?.length)
    .map(([id, label]) => `${escapeHtml(keyLabel(config.bindings[id][0]))}: ${label}`);
  return `PREFIX  ·  ${hints.join('  ·  ')}${hints.length ? '  ·  ' : ''}Esc: cancel`;
}

export function showStatus(text) {
  const root = ui();
  if (!barEl) { barEl = document.createElement("div"); barEl.className = "bar"; root.appendChild(barEl); }
  barEl.style.display = "flex";
  barEl.innerHTML = `<span>${text}</span><span class="tag">${prefixLabel()}</span>`;
}

export function hideStatus() {
  if (barEl) barEl.style.display = "none";
}

export function flash(text) {
  const root = ui();
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; root.appendChild(toastEl); }
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1100);
}

let errorEl;
export function showFailure(message, retry) {
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.className = 'failure';
    errorEl.setAttribute('role','alert');
    ui().appendChild(errorEl);
  }
  errorEl.replaceChildren();
  const text = document.createElement('span'); text.textContent = message;
  errorEl.appendChild(text);
  if (retry) {
    const button = document.createElement('button'); button.textContent = 'Retry';
    button.addEventListener('click', e => { if (e.isTrusted) retry(); });
    errorEl.appendChild(button);
  }
}
export function clearFailure() { errorEl?.remove(); errorEl = null; }
