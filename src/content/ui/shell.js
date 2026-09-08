// The shadow-DOM host tabmux renders all of its UI into, so page CSS can never
// bleed in (and tabmux's CSS can never bleed onto the page).

// Two-color scheme: #1C1C1D (bg) / #E4E4E5 (text). Everything else — muted
// text, borders, the selected-row/primary look — is an alpha variant or a
// straight inversion of those same two colors, not a third hue. The tab-group
// swatch dots are the one deliberate exception: they mirror each group's
// real Chrome color, so they're data, not theme.
const CSS = `
  .failure { position:fixed; bottom:34px; left:12px; right:12px; padding:10px; background:#1C1C1D; color:#E4E4E5; border:1px solid #E4E4E5; display:flex; align-items:center; gap:12px; pointer-events:auto; font-size:12px; }
  button { font:inherit; padding:4px 8px; cursor:pointer; }
  :focus-visible { outline:2px solid #E4E4E5; outline-offset:3px; }
  .row > span:first-child { overflow-wrap:anywhere; min-width:0; }
  .row .meta { flex-shrink:0; }
  @media (prefers-reduced-motion:reduce) { * { transition:none !important; } }

  :host, * { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-sizing: border-box; }
  :host {
    --bg: #1C1C1D;
    --fg: #E4E4E5;
    --fg-muted: rgba(228, 228, 229, 0.55);
    --border: rgba(228, 228, 229, 0.2);
  }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; height: 24px; line-height: 24px;
         background: var(--bg); color: var(--fg); font-size: 12px; padding: 0 10px;
         display: flex; justify-content: space-between; gap: 12px; pointer-events: none;
         border-top: 1px solid var(--border); }
  .bar .tag { color: var(--fg-muted); }
  .toast { position: fixed; bottom: 34px; left: 50%; transform: translateX(-50%);
           background: var(--bg); color: var(--fg); border: 1px solid var(--border);
           padding: 5px 12px; font-size: 12px; border-radius: 4px; pointer-events: none;
           opacity: 0; transition: opacity .12s; }
  .toast.show { opacity: 1; }
  .panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
           background: var(--bg); color: var(--fg); border: 1px solid var(--border);
           border-radius: 8px; padding: 16px 18px; font-size: 13px; pointer-events: auto;
           width: min(560px, calc(100vw - 24px)); max-width: 560px; max-height: 74vh; overflow: auto;
           box-shadow: 0 12px 40px rgba(0,0,0,.5); }
  .panel h2 { margin: 0 0 10px; font-size: 13px; color: var(--fg); letter-spacing: .04em; }
  .panel .grid { display: grid; grid-template-columns: max-content 1fr; gap: 3px 16px; }
  .panel .k { color: var(--fg); white-space: nowrap; }
  .panel .d { color: var(--fg-muted); }
  .panel .hint { margin-top: 12px; color: var(--fg-muted); font-size: 11px; }
  .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; }
  .row { padding: 5px 8px; border-radius: 4px; display: flex; justify-content: space-between; gap: 12px; }
  .row.sel { background: var(--fg); color: var(--bg); }
  .row .meta { color: var(--fg-muted); font-size: 11px; }
  .row.sel .meta { color: var(--bg); opacity: .65; }
  .empty { color: var(--fg-muted); padding: 8px; }
  .prompt { position: fixed; left: 0; right: 0; bottom: 0; height: 30px;
            background: var(--bg); color: var(--fg); display: flex; align-items: center;
            padding: 0 10px; pointer-events: auto; border-top: 1px solid var(--border); }
  .prompt .lead { color: var(--fg-muted); margin-right: 8px; }
  .prompt input { all: unset; flex: 1; color: var(--fg); font-size: 13px; caret-color: var(--fg); }
`;

let root;

export function ui() {
  if (root?.host.isConnected) return root;
  const host = document.createElement("div");
  host.id = "tabmux-host";
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; inset: 0; pointer-events: none;";
  (document.documentElement || document.body).appendChild(host);
  root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);
  return root;
}
