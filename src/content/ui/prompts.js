import { resetTransientMode } from '../mode.js';
import { interaction } from '../state.js';
// The `prefix S` new-session prompt, `prefix d` detach prompt, and the
// `prefix :` general command prompt.
import { send, sendAsync } from "../messaging.js";
import { config, sessionReplace } from "../config.js";
import { flash } from "./status.js";
import { openInput } from "./overlay.js";

export function openNewGroupPrompt() {
  openInput('new group:', '', value => {
    const name = value.trim();
    if (name) send({ type: 'group-create', name });
  }, () => {});
}

// tmux `new -s <name>`: open a fresh session and name it right away. Enter
// does whatever config.sessionReplaceDefault says; shift+enter always gets
// the other one — same split as the session picker's restore.
export function openNewSessionPrompt() {
  const lead = config.sessionReplaceDefault
    ? "new session (shift+enter opens a new window):"
    : "new session (shift+enter replaces this window):";
  openInput(lead, "", (name, shiftKey) => {
    if (name) send({ type: "new-session", name, replace: sessionReplace(shiftKey) });
  }, () => {});
}

export async function openDetachPrompt() {
  const token = interaction;
  const res = await sendAsync({ type: "get-session-name" });
  if (token !== interaction) return;
  if (res.error) { resetTransientMode(); return; }
  const def = (res && res.name) || "session-" + new Date().toISOString().slice(5, 16).replace("T", "-").replace(":", "");
  openInput("detach as:", def, (name) => { if (name) send({ type: "detach", name }); }, () => {});
}

export function openCommandPrompt() {
  openInput(":", "", (line) => {
    const [verb, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(" ");
    if (verb === "session" && arg) send({ type: "new-session", name: arg, replace: sessionReplace(false) });
    else if (verb === "session!" && arg) send({ type: "new-session", name: arg, replace: sessionReplace(true) });
    else if (verb === "save") send({ type: "save-session", name: arg });
    else if (verb === "restore" && arg) send({ type: "restore-session", name: arg, replace: sessionReplace(false) });
    else if (verb === "restore!" && arg) send({ type: "restore-session", name: arg, replace: sessionReplace(true) });
    else if (verb === "kill" && arg) send({ type: "delete-session", name: arg });
    else if (verb === "new") send({ type: "new-tab" });
    else if (verb === "group" && arg) send({ type: "group-add", name: arg });
    else if (verb === "ungroup") send({ type: "group-remove" });
    else if (verb) flash("? " + verb);
  }, () => {});
}
