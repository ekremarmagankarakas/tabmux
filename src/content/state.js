// Shared mutable state for the key-handling state machine. Exported as live
// bindings (ES module `let` exports stay live across modules) plus setters,
// since several modules across mode/copy-mode/overlay need to read and update
// the same current value.

// "normal" | "command" | "copy" — which layer owns the next keydown.
export let mode = "normal";
export function setMode(m) { mode = m; }

// The currently open overlay, or null. { el, handler? } — handler is absent
// for input-owned overlays (see ui/overlay.js).
export let activeOverlay = null;
export function setActiveOverlay(o) { activeOverlay = o; }

// Invalidates delayed overlay openers when focus or the current interaction changes.
export let interaction = 0;
export function invalidateInteraction() { interaction++; }
