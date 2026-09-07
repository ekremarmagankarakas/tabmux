// The bottom status bar and the transient toast, plus the prefix label they
// both share.
import { config } from "../config.js";
import { ui } from "./shell.js";

let barEl, toastEl, toastTimer;

export function prefixLabel() {
  const p = config.prefix;
  const m = [];
  if (p.ctrl) m.push("C");
  if (p.alt) m.push("A");
  if (p.shift) m.push("S");
  return m.concat(p.key).join("-");
}

export function idleStatus() {
  return `[tabmux]  prefix ${prefixLabel()}  ·  ? for keys`;
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
