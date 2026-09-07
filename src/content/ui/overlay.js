// Generic overlay lifecycle, plus the shared single-line input prompt built on
// top of it.
//
// onKey is optional: pickers (session/group list, help) pass a handler that
// owns every keystroke. Text-input overlays (openInput) pass nothing, because
// an ancestor-level capturing listener that stopPropagation()s on every key
// would stop the event before it ever reaches the <input> inside the shadow
// root — the input's own listener would never fire, silently swallowing
// Enter/Escape and leaving the overlay unclosable.
import { config } from "../config.js";
import { activeOverlay, setActiveOverlay, setMode } from "../state.js";
import { escapeHtml } from "../utils.js";
import { ui } from "./shell.js";
import { showStatus, hideStatus, idleStatus } from "./status.js";

export function openOverlay(el, onKey) {
  ui().appendChild(el);
  const overlay = { el };
  if (onKey) {
    overlay.handler = (e) => { e.stopPropagation(); onKey(e); };
    document.addEventListener("keydown", overlay.handler, true);
  }
  setActiveOverlay(overlay);
}

export function closeOverlay() {
  if (!activeOverlay) return;
  if (activeOverlay.handler) document.removeEventListener("keydown", activeOverlay.handler, true);
  activeOverlay.el.remove();
  setActiveOverlay(null);
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
  el.appendChild(input);
  openOverlay(el); // no onKey — the <input> below handles its own keys
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { const v = input.value; closeOverlay(); onSubmit(v); }
    else if (e.key === "Escape") { closeOverlay(); onCancel(); }
  }, true);
}
