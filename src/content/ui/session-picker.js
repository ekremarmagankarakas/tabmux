// The `prefix s` overlay: browse, restore, and delete saved sessions.
import { send, sendAsync } from "../messaging.js";
import { div, escapeHtml, timeAgo } from "../utils.js";
import { openOverlay, closeOverlay } from "./overlay.js";

export async function openSessionPicker() {
  const res = await sendAsync({ type: "list-sessions" });
  const sessions = (res && res.sessions) || [];
  let sel = 0;
  const el = div("", "panel");

  function render() {
    el.innerHTML =
      `<h2>sessions</h2>` +
      (sessions.length
        ? sessions.map((s, i) =>
            `<div class="row ${i === sel ? "sel" : ""}"><span>${escapeHtml(s.name)}</span>` +
            `<span class="meta">${s.count} tabs · ${timeAgo(s.savedAt)}</span></div>`).join("")
        : `<div class="empty">no saved sessions — use prefix : then "save &lt;name&gt;"</div>`) +
      `<div class="hint">j/k move · enter restore · d delete · esc close</div>`;
  }
  render();

  openOverlay(el, async (e) => {
    e.preventDefault();
    if (e.key === "Escape") return closeOverlay();
    if (!sessions.length) return;
    if (e.key === "j" || e.key === "ArrowDown") { sel = (sel + 1) % sessions.length; render(); }
    else if (e.key === "k" || e.key === "ArrowUp") { sel = (sel - 1 + sessions.length) % sessions.length; render(); }
    else if (e.key === "Enter") { closeOverlay(); send({ type: "restore-session", name: sessions[sel].name }); }
    else if (e.key === "d") {
      await sendAsync({ type: "delete-session", name: sessions[sel].name });
      sessions.splice(sel, 1);
      if (sel >= sessions.length) sel = Math.max(0, sessions.length - 1);
      render();
    }
  });
}
