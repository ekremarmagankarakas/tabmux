import { resetTransientMode } from '../mode.js';
import { interaction } from '../state.js';
// The `prefix s` overlay: browse, restore, and delete saved sessions.
import { send, sendAsync } from "../messaging.js";
import { config, sessionReplace } from "../config.js";
import { div, escapeHtml, timeAgo } from "../utils.js";
import { openOverlay, closeOverlay, scrollSelection } from "./overlay.js";

export async function openSessionPicker() {
  const token = interaction;
  const res = await sendAsync({ type: "list-sessions" });
  if (token !== interaction) return;
  if (res.error) { resetTransientMode(); return; }
  const sessions = (res && res.sessions) || [];
  let sel = 0;
  let busy = false;
  const el = div("", "panel");

  function render() {
    el.innerHTML =
      `<h2>sessions</h2>` +
      (sessions.length
        ? sessions.map((s, i) =>
            `<div class="row ${i === sel ? "sel" : ""}"><span>${escapeHtml(s.name)}</span>` +
            `<span class="meta">${s.count} tabs · ${timeAgo(s.savedAt)}</span></div>`).join("")
        : `<div class="empty">no saved sessions — save this window from the toolbar picker</div>`) +
      (config.sessionReplaceDefault
        ? `<div class="hint">j/k move · enter replace this window · shift+enter open (new window) · d delete · esc close</div>`
        : `<div class="hint">j/k move · enter open (new window) · shift+enter replace this window · d delete · esc close</div>`);
    scrollSelection(el);
  }
  render();

  openOverlay(el, async (e) => {
    e.preventDefault();
    if (e.key === "Escape") return closeOverlay();
    if (!sessions.length || busy) return;
    if (e.key === "j" || e.key === "ArrowDown") { sel = (sel + 1) % sessions.length; render(); }
    else if (e.key === "k" || e.key === "ArrowUp") { sel = (sel - 1 + sessions.length) % sessions.length; render(); }
    else if (e.key === "Enter") { closeOverlay(); send({ type: "restore-session", name: sessions[sel].name, replace: sessionReplace(e.shiftKey) }); }
    else if (e.key === "d") {
      const target = sessions[sel];
      busy = true;
      const result = await sendAsync({ type: "delete-session", name: target.name });
      busy = false;
      if (result.error) return;
      sessions.splice(sessions.indexOf(target), 1);
      if (sel >= sessions.length) sel = Math.max(0, sessions.length - 1);
      render();
    }
  });
}
