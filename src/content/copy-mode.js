// Vim-ish scroll/search mode on the current page, entered via `prefix [`.
import { setMode } from "./state.js";
import { config } from "./config.js";
import { showStatus, hideStatus, idleStatus } from "./ui/status.js";
import { openInput } from "./ui/overlay.js";

let lastSearch = "";

export function enterCopyMode() {
  setMode("copy");
  showStatus("COPY  ·  j k  d u  space b  g G  / n  q:exit");
}

export function exitCopyMode() {
  setMode("normal");
  if (config.alwaysShowStatus) showStatus(idleStatus());
  else hideStatus();
}

export function handleCopyKey(e) {
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

function scrollBy(x, y) {
  window.scrollBy({ top: y, left: x, behavior: "instant" });
}
