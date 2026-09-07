// The `prefix N` new-session prompt, `prefix d` detach prompt, and the
// `prefix :` general command prompt.
import { send, sendAsync } from "../messaging.js";
import { flash } from "./status.js";
import { openInput } from "./overlay.js";

// tmux `new -s <name>`: open a fresh window and name it right away.
export function openNewSessionPrompt() {
  openInput("new session:", "", (name) => { if (name) send({ type: "new-session", name }); }, () => {});
}

export async function openDetachPrompt() {
  const res = await sendAsync({ type: "get-session-name" });
  const def = (res && res.name) || "session-" + new Date().toISOString().slice(5, 16).replace("T", "-").replace(":", "");
  openInput("detach as:", def, (name) => { if (name) send({ type: "detach", name }); }, () => {});
}

export function openCommandPrompt() {
  openInput(":", "", (line) => {
    const [verb, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(" ");
    if (verb === "session" && arg) send({ type: "new-session", name: arg });
    else if (verb === "save") send({ type: "save-session", name: arg });
    else if (verb === "restore" && arg) send({ type: "restore-session", name: arg });
    else if (verb === "kill" && arg) send({ type: "delete-session", name: arg });
    else if (verb === "new") send({ type: "new-tab" });
    else if (verb === "group" && arg) send({ type: "group-add", name: arg });
    else if (verb === "ungroup") send({ type: "group-remove" });
    else if (verb) flash("? " + verb);
  }, () => {});
}
