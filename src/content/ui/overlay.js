// Generic overlay lifecycle, plus the shared single-line input prompt built on
// top of it.
//
// onKey is optional: pickers (session/group list, help) pass a handler that
// owns every keystroke. Text-input overlays (openInput) pass nothing, because
// an ancestor-level capturing listener that stopPropagation()s on every key
// would stop the event before it ever reaches the <input> inside the shadow
// root — the input's own listener would never fire, silently swallowing
// Enter/Escape and leaving the overlay unclosable.
import { trustedKey, focusedElement } from '../input.js';
import { config } from "../config.js";
import { activeOverlay, setActiveOverlay, setMode } from "../state.js";
import { escapeHtml } from "../utils.js";
import { ui } from "./shell.js";
import { showStatus, hideStatus, idleStatus } from "./status.js";

export function openOverlay(el, onKey) {
  // Async openers (session/group pickers, detach's name-prefill fetch) call
  // this only after an await, with nothing blocking a second prefix-command
  // from firing during that gap and starting a second one. Rather than strand
  // whichever opened first — unclosable, since activeOverlay would only ever
  // point at the second — replace it outright.
  if (activeOverlay) closeOverlay();
  ui().appendChild(el);
  el.setAttribute('role', el.querySelector('.row') ? 'listbox' : 'dialog');
  el.setAttribute('aria-label', el.querySelector('h2')?.textContent || 'tabmux command');
  el.tabIndex = -1;
  const overlay = { el, previousFocus: focusedElement() };
  if (onKey) {
    overlay.handler = (e) => {
      if (!trustedKey(e)) return;
      e.stopImmediatePropagation();
      if (e.repeat && !['j','k','ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); return; }
      Promise.resolve(onKey(e)).catch(console.error);
    };
    document.addEventListener("keydown", overlay.handler, true);
  }
  setActiveOverlay(overlay);
  if (onKey) el.focus();
}

export function closeOverlay(restoreFocus = true) {
  if (!activeOverlay) return;
  if (activeOverlay.handler) document.removeEventListener("keydown", activeOverlay.handler, true);
  const previousFocus = activeOverlay.previousFocus;
  activeOverlay.el.remove();
  setActiveOverlay(null);
  if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
  setMode("normal");
  if (config.alwaysShowStatus) showStatus(idleStatus());
  else hideStatus();
}

export function openInput(lead, value, onSubmit, onCancel) {
  const el = document.createElement("div");
  el.className = "prompt";
  el.innerHTML = `<span class="lead">${escapeHtml(lead)}</span>`;
  const input = document.createElement("input");
  input.value = value;
  input.setAttribute("aria-label", lead);
  el.appendChild(input);
  openOverlay(el); // no onKey — the <input> below handles its own keys
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener("keydown", (e) => {
    if (!trustedKey(e)) return;
    e.stopImmediatePropagation();
    if (e.key === 'Tab') { e.preventDefault(); return; }
    if (e.repeat && ['Enter','Escape'].includes(e.key)) { e.preventDefault(); return; }
    if (e.key === "Enter") { e.preventDefault(); const v = input.value; const shiftKey = e.shiftKey; closeOverlay(); onSubmit(v, shiftKey); }
    else if (e.key === "Escape") { e.preventDefault(); closeOverlay(); onCancel(); }
  }, true);
}

let listId = 0;
export function scrollSelection(el) {
  if (!el.id) el.id = `tabmux-list-${++listId}`;
  for (const [i,row] of [...el.querySelectorAll('.row')].entries()) {
    row.id = `${el.id}-${i}`;
    row.setAttribute('role','option');
    row.setAttribute('aria-selected', String(row.classList.contains('sel')));
  }
  const selected = el.querySelector('.sel');
  if (selected) el.setAttribute('aria-activedescendant',selected.id);
  else el.removeAttribute('aria-activedescendant');
  el.querySelector('.sel')?.scrollIntoView?.({ block:'nearest' });
}
