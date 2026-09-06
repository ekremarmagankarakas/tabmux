// tabmux — content script
// The modal command layer. Listens for the prefix chord, then dispatches the
// next keystroke as a command. All UI lives in a shadow root so page CSS can't
// touch it. Panes/tabs/sessions are executed by background.js.

(() => {
  "use strict";

  const DEFAULTS = {
    prefix: { ctrl: true, alt: false, shift: false, key: "b" }, // tmux-style Ctrl-b
    timeoutMs: 2500,        // auto-leave command mode after inactivity
    alwaysShowStatus: false // keep a tmux-like status bar visible at all times
  };
  let cfg = { ...DEFAULTS };

  // modes: "normal" | "command" | "copy". Overlays take over key handling.
  let mode = "normal";
  let activeOverlay = null; // {onKey(e)} or null
  let cmdTimer = null;

  chrome.storage.local.get("tabmux:config").then((s) => {
    if (s["tabmux:config"]) cfg = { ...cfg, ...s["tabmux:config"] };
    if (cfg.alwaysShowStatus) showStatus(idleStatus(), true);
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch["tabmux:config"]) cfg = { ...cfg, ...ch["tabmux:config"].newValue };
  });

  /* ---------- messaging ---------- */
  function send(msg) {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.error) flash("⚠ " + res.error);
      else if (res && res.toast) flash(res.toast);
    });
  }

  /* ---------- command table (single source of truth, also drives help) ---------- */
  const CMDS = {
    "c":   ["new tab",              () => send({ type: "new-tab" })],
    "x":   ["close tab",            () => send({ type: "close-tab" })],
    "n":   ["next tab",             () => send({ type: "next-tab" })],
    "p":   ["previous tab",         () => send({ type: "prev-tab" })],
    "Tab": ["last tab",             () => send({ type: "last-tab" })],
    ";":   ["last tab",             () => send({ type: "last-tab" })],
    "%":   ["split panes ↔",        () => send({ type: "split", dir: "vertical" })],
    '"':   ["split panes ↕",        () => send({ type: "split", dir: "horizontal" })],
    "o":   ["focus next pane",      () => send({ type: "focus-window", dir: "next" })],
    "h":   ["focus pane ←",         () => send({ type: "focus-window", dir: "left" })],
    "j":   ["focus pane ↓",         () => send({ type: "focus-window", dir: "down" })],
    "k":   ["focus pane ↑",         () => send({ type: "focus-window", dir: "up" })],
    "l":   ["focus pane →",         () => send({ type: "focus-window", dir: "right" })],
    "ArrowLeft":  ["focus pane ←",  () => send({ type: "focus-window", dir: "left" })],
    "ArrowDown":  ["focus pane ↓",  () => send({ type: "focus-window", dir: "down" })],
    "ArrowUp":    ["focus pane ↑",  () => send({ type: "focus-window", dir: "up" })],
    "ArrowRight": ["focus pane →",  () => send({ type: "focus-window", dir: "right" })],
    "z":   ["zoom pane (maximize)", () => send({ type: "zoom" })],
    "E":   ["tile all panes",       () => send({ type: "tile" })],
    "s":   ["session picker",       openSessionPicker],
    "d":   ["detach (save+close)",  openDetachPrompt],
    ":":   ["command prompt",       openCommandPrompt],
    "[":   ["copy/scroll mode",     enterCopyMode],
    "?":   ["help",                 openHelp]
  };

  /* ---------- key handling ---------- */
  function matchesPrefix(e) {
    return (
      !!e.ctrlKey === !!cfg.prefix.ctrl &&
      !!e.altKey === !!cfg.prefix.alt &&
      !!e.shiftKey === !!cfg.prefix.shift &&
      e.key.toLowerCase() === cfg.prefix.key.toLowerCase()
    );
  }

  function tokenFor(e) {
    if (/^Arrow/.test(e.key) || e.key === "Tab") return e.key;
    if (/^[0-9]$/.test(e.key)) return e.key;
    return e.key; // includes shifted chars like % " ; :
  }

  function onKeyDown(e) {
    if (activeOverlay) return; // overlay owns its input
    if (mode === "command") return handleCommandKey(e);
    if (mode === "copy") return handleCopyKey(e);
    if (matchesPrefix(e)) {
      e.preventDefault();
      e.stopPropagation();
      enterCommand();
    }
  }

  function enterCommand() {
    mode = "command";
    showStatus("PREFIX  ·  c n p x  %  \"  o hjkl  z E  s d :  [  ?", true);
    resetTimer();
  }
  function exitCommand() {
    mode = "normal";
    clearTimeout(cmdTimer);
    if (cfg.alwaysShowStatus) showStatus(idleStatus(), true);
    else hideStatus();
  }
  function resetTimer() {
    clearTimeout(cmdTimer);
    cmdTimer = setTimeout(exitCommand, cfg.timeoutMs);
  }

  function handleCommandKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "Enter" || (e.ctrlKey && e.key === "c")) {
      return exitCommand();
    }
    if (/^[1-9]$/.test(e.key)) {
      send({ type: "select-tab", index: parseInt(e.key, 10) });
      return exitCommand();
    }
    const entry = CMDS[tokenFor(e)];
    if (entry) {
      const opensOverlay = ["s", "d", ":", "?"].includes(e.key);
      const entersCopy = e.key === "[";
      entry[1]();
      if (!opensOverlay && !entersCopy) exitCommand();
      else clearTimeout(cmdTimer);
    } else {
      exitCommand();
    }
  }

  /* ---------- copy / scroll mode (vim-ish) ---------- */
  function enterCopyMode() {
    mode = "copy";
    showStatus("COPY  ·  j k  d u  space b  g G  / n  q:exit", true);
  }
  function exitCopyMode() {
    mode = "normal";
    if (cfg.alwaysShowStatus) showStatus(idleStatus(), true);
    else hideStatus();
  }
  let lastSearch = "";
  function handleCopyKey(e) {
    const H = window.innerHeight;
    const step = 60;
    const map = {
      j: () => scrollBy(0, step),
      k: () => scrollBy(0, -step),
      d: () => scrollBy(0, H / 2),
      u: () => scrollBy(0, -H / 2),
      " ": () => scrollBy(0, H * 0.9),
      b: () => scrollBy(0, -H * 0.9),
      f: () => scrollBy(0, H * 0.9),
      g: () => window.scrollTo({ top: 0 }),
      G: () => window.scrollTo({ top: document.body.scrollHeight }),
      n: () => { if (lastSearch) window.find(lastSearch); }
    };
    if (e.key === "q" || e.key === "Escape") { e.preventDefault(); return exitCopyMode(); }
    if (e.key === "/") {
      e.preventDefault();
      openInput("/", "", (term) => {
        lastSearch = term;
        if (term) window.find(term);
        enterCopyMode();
      }, enterCopyMode);
      return;
    }
    if (map[e.key]) { e.preventDefault(); e.stopPropagation(); map[e.key](); }
  }
  function scrollBy(x, y) { window.scrollBy({ top: y, left: x, behavior: "instant" }); }

  /* ================= UI (shadow DOM) ================= */
  let host, root;
  function ui() {
    if (root) return root;
    host = document.createElement("div");
    host.id = "tabmux-host";
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; inset: 0; pointer-events: none;";
    (document.documentElement || document.body).appendChild(host);
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    return root;
  }

  const CSS = `
    :host, * { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-sizing: border-box; }
    .bar { position: fixed; left: 0; right: 0; bottom: 0; height: 24px; line-height: 24px;
           background: #15803d; color: #eafff0; font-size: 12px; padding: 0 10px;
           display: flex; justify-content: space-between; gap: 12px; pointer-events: none;
           box-shadow: 0 -1px 0 rgba(0,0,0,.35); }
    .bar .tag { color: #bbf7d0; }
    .toast { position: fixed; bottom: 34px; left: 50%; transform: translateX(-50%);
             background: #052e16; color: #d1fae5; border: 1px solid #15803d;
             padding: 5px 12px; font-size: 12px; border-radius: 4px; pointer-events: none;
             opacity: 0; transition: opacity .12s; }
    .toast.show { opacity: 1; }
    .panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
             background: #0b1220; color: #e5e7eb; border: 1px solid #1f9d55;
             border-radius: 8px; padding: 16px 18px; font-size: 13px; pointer-events: auto;
             min-width: 340px; max-width: 560px; max-height: 74vh; overflow: auto;
             box-shadow: 0 12px 40px rgba(0,0,0,.5); }
    .panel h2 { margin: 0 0 10px; font-size: 13px; color: #34d399; letter-spacing: .04em; }
    .panel .grid { display: grid; grid-template-columns: max-content 1fr; gap: 3px 16px; }
    .panel .k { color: #fbbf24; white-space: nowrap; }
    .panel .d { color: #cbd5e1; }
    .panel .hint { margin-top: 12px; color: #64748b; font-size: 11px; }
    .row { padding: 5px 8px; border-radius: 4px; display: flex; justify-content: space-between; gap: 12px; }
    .row.sel { background: #15803d; color: #fff; }
    .row .meta { color: #64748b; font-size: 11px; }
    .row.sel .meta { color: #d1fae5; }
    .empty { color: #64748b; padding: 8px; }
    .prompt { position: fixed; left: 0; right: 0; bottom: 0; height: 30px;
              background: #052e16; color: #eafff0; display: flex; align-items: center;
              padding: 0 10px; pointer-events: auto; border-top: 1px solid #1f9d55; }
    .prompt .lead { color: #fbbf24; margin-right: 8px; }
    .prompt input { all: unset; flex: 1; color: #eafff0; font-size: 13px; caret-color: #34d399; }
  `;

  /* status bar + toast */
  let barEl, toastEl, toastTimer;
  function idleStatus() { return `[tabmux]  prefix ${prefixLabel()}  ·  ? for keys`; }
  function prefixLabel() {
    const p = cfg.prefix; const m = [];
    if (p.ctrl) m.push("C"); if (p.alt) m.push("A"); if (p.shift) m.push("S");
    return m.concat(p.key).join("-");
  }
  function showStatus(text, persist) {
    ui();
    if (!barEl) { barEl = document.createElement("div"); barEl.className = "bar"; root.appendChild(barEl); }
    barEl.style.display = "flex";
    barEl.innerHTML = `<span>${text}</span><span class="tag">${prefixLabel()}</span>`;
  }
  function hideStatus() { if (barEl) barEl.style.display = "none"; }
  function flash(text) {
    ui();
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; root.appendChild(toastEl); }
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1100);
  }

  /* generic overlay lifecycle */
  function openOverlay(el, onKey) {
    ui().appendChild(el);
    activeOverlay = { el, onKey };
    // capture keys at the shadow root so they don't reach the page
    activeOverlay.handler = (e) => { e.stopPropagation(); onKey(e); };
    document.addEventListener("keydown", activeOverlay.handler, true);
  }
  function closeOverlay() {
    if (!activeOverlay) return;
    document.removeEventListener("keydown", activeOverlay.handler, true);
    activeOverlay.el.remove();
    activeOverlay = null;
    mode = "normal";
    if (cfg.alwaysShowStatus) showStatus(idleStatus(), true); else hideStatus();
  }

  /* help */
  function openHelp() {
    const rows = Object.entries(CMDS)
      .filter(([k]) => !["Tab", ";", "ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"].includes(k))
      .map(([k, v]) => `<div class="k">${prefixLabel()} ${escapeHtml(k)}</div><div class="d">${v[0]}</div>`)
      .join("");
    const extra =
      `<div class="k">${prefixLabel()} 1-9</div><div class="d">jump to tab N</div>` +
      `<div class="k">${prefixLabel()} ↑↓←→</div><div class="d">focus pane by direction</div>`;
    const el = div(`<h2>tabmux — keybindings</h2><div class="grid">${rows}${extra}</div>
      <div class="hint">panes are tiled browser windows · press any key to close</div>`, "panel");
    openOverlay(el, () => closeOverlay());
  }

  /* session picker */
  async function openSessionPicker() {
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

  /* detach prompt */
  function openDetachPrompt() {
    const def = "session-" + new Date().toISOString().slice(5, 16).replace("T", "-").replace(":", "");
    openInput("detach as:", def, (name) => { if (name) send({ type: "detach", name }); }, () => {});
  }

  /* general command prompt (":") — save/restore/kill/new */
  function openCommandPrompt() {
    openInput(":", "", (line) => {
      const [verb, ...rest] = line.trim().split(/\s+/);
      const arg = rest.join(" ");
      if (verb === "save" && arg) send({ type: "save-session", name: arg });
      else if (verb === "restore" && arg) send({ type: "restore-session", name: arg });
      else if (verb === "kill" && arg) send({ type: "delete-session", name: arg });
      else if (verb === "new") send({ type: "new-tab" });
      else if (verb) flash("? " + verb);
    }, () => {});
  }

  /* shared single-line input overlay */
  function openInput(lead, value, onSubmit, onCancel) {
    const el = document.createElement("div");
    el.className = "prompt";
    el.innerHTML = `<span class="lead">${escapeHtml(lead)}</span>`;
    const input = document.createElement("input");
    input.value = value;
    el.appendChild(input);
    openOverlay(el, () => {}); // input handles its own keys below
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { const v = input.value; closeOverlay(); onSubmit(v); }
      else if (e.key === "Escape") { closeOverlay(); onCancel(); }
    }, true);
  }

  /* helpers */
  function div(html, cls) { const d = document.createElement("div"); if (cls) d.className = cls; d.innerHTML = html; return d; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + "s"; if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h"; return Math.floor(s / 86400) + "d";
  }
  function sendAsync(msg) { return new Promise((r) => chrome.runtime.sendMessage(msg, (res) => r(chrome.runtime.lastError ? {} : res))); }

  window.addEventListener("keydown", onKeyDown, true);
})();
