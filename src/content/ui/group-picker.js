import { resetTransientMode } from '../mode.js';
import { interaction } from '../state.js';
// Two entry points sharing one picker: `prefix t` (openGroupPicker) browses
// tab groups — jump to one, add the current tab, create/rename/collapse/
// close. `prefix N` (openSendToGroupPicker) is the fast path for the single
// most common action, "file this tab into a group" — same list, but Enter
// sends the current tab there instead of jumping to it, and the housekeeping
// keys (rename/collapse/close) are dropped since they're not what "send" is
// for.
import { send, sendAsync } from "../messaging.js";
import { div, escapeHtml } from "../utils.js";
import { openOverlay, closeOverlay, openInput, scrollSelection } from "./overlay.js";

const GROUP_HEX = {
  grey: "#5f6368", blue: "#1a73e8", red: "#d93025", yellow: "#f9ab00", green: "#188038",
  pink: "#d01884", purple: "#a142f4", cyan: "#007b83", orange: "#fa903e"
};

export function openGroupPicker() {
  return runGroupPicker("jump");
}

export function openSendToGroupPicker() {
  return runGroupPicker("send");
}

async function runGroupPicker(verb) {
  const token = interaction;
  const res = await sendAsync({ type: "list-groups" });
  if (token !== interaction) return;
  if (res.error) { resetTransientMode(); return; }
  const groups = (res && res.groups) || [];
  const currentGroupId = res && res.currentGroupId;
  let sel = Math.max(0, groups.findIndex((g) => g.id === currentGroupId));
  let busy = false;
  const el = div("", "panel");
  const title = verb === "send" ? "send tab to group" : "tab groups";
  const enterHint = verb === "send" ? "enter send here" : "enter jump";
  const emptyHint = verb === "send" ? "and send this tab" : "from the current tab";

  function render() {
    el.innerHTML =
      `<h2>${title}</h2>` +
      (groups.length
        ? groups.map((g, i) =>
            `<div class="row ${i === sel ? "sel" : ""}">` +
            `<span><span class="swatch" style="background:${GROUP_HEX[g.color] || "#5f6368"}"></span>` +
            `${escapeHtml(g.title || "(untitled)")}${g.collapsed ? " ⌄" : ""}</span>` +
            `<span class="meta">${g.count} tabs</span></div>`).join("")
        : `<div class="empty">no groups yet — press "n" to create one ${emptyHint}</div>`) +
      (verb === "send"
        ? `<div class="hint">j/k move · ${enterHint} · n new group · esc cancel</div>`
        : `<div class="hint">j/k move · ${enterHint} · a add current tab · n new · r rename · c collapse · x close · esc close</div>`);
    scrollSelection(el);
  }
  render();

  openOverlay(el, async (e) => {
    e.preventDefault();
    if (e.key === "Escape") return closeOverlay();
    if (busy) return;
    if (e.key === "n") {
      closeOverlay();
      return openInput("new group:", "", (name) => { if (name) send({ type: "group-add", name }); }, () => {});
    }
    if (!groups.length) return;
    if (e.key === "j" || e.key === "ArrowDown") { sel = (sel + 1) % groups.length; render(); }
    else if (e.key === "k" || e.key === "ArrowUp") { sel = (sel - 1 + groups.length) % groups.length; render(); }
    else if (e.key === "Enter") {
      closeOverlay();
      send(verb === "send" ? { type: "group-add-to", groupId: groups[sel].id } : { type: "focus-group", groupId: groups[sel].id });
    }
    else if (verb === "jump" && e.key === "a") { closeOverlay(); send({ type: "group-add-to", groupId: groups[sel].id }); }
    else if (verb === "jump" && e.key === "c") {
      const target = groups[sel]; busy = true;
      const result = await sendAsync({ type: "toggle-group-collapse", groupId: target.id });
      busy = false; if (result.error) return;
      target.collapsed = !target.collapsed;
      render();
    } else if (verb === "jump" && e.key === "x") {
      const target = groups[sel]; busy = true;
      const result = await sendAsync({ type: "close-group", groupId: target.id });
      busy = false; if (result.error) return;
      groups.splice(groups.indexOf(target), 1);
      if (sel >= groups.length) sel = Math.max(0, groups.length - 1);
      render();
    } else if (verb === "jump" && e.key === "r") {
      const g = groups[sel];
      closeOverlay();
      openInput("rename:", g.title || "", (title) => { if (title) send({ type: "rename-group", groupId: g.id, title }); }, () => {});
    }
  });
}
