# tabmux

Drive Chrome from the keyboard like tmux: a **prefix key**, **modal commands**,
**tab groups**, and **saved sessions**. Built for people who live in
tmux/Neovim and want fast, keyboard-driven tab organization.

## Model

| tmux            | tabmux                                              |
|-----------------|-----------------------------------------------------|
| window          | Chrome tab                                           |
| session         | a named, saved set of tabs                           |
| —               | **tab group** — native Chrome tab groups, for clustering tabs within a window |
| prefix (`C-b`)  | prefix chord, then a command key                     |
| copy mode       | vim-ish scroll/search mode on the current page       |

A common setup: one Chrome **window per session** (work, personal,
research…), with **tab groups inside each window** for sub-topics, switching
between them with `prefix g` / `prefix G`. Sessions save each tab's group
membership too (title, color, collapsed state) — restoring recreates the
groups, not just a flat list of tabs. Chrome only allows a group's tabs to
sit contiguously in the strip, though, so restoring can shuffle overall tab
order slightly to keep each group together; membership and group appearance
come back exactly as saved regardless.

`prefix N` (or `:session <name>`) is the `tmux new -s <name>` equivalent — it
**replaces the window you invoked it from** with a fresh blank one named and
saved immediately, the same way `tmux new` repurposes the terminal you're
sitting in rather than opening a second one. From then on that window is a
*live* session: opening/closing/navigating/reordering/pinning tabs in it
autosaves in the background (debounced ~600ms), same as `:save <name>` on any
existing window makes it live going forward. `prefix d` (detach) still has
its own job on top of that: save-then-**close** the window when you're done
with it for now.

Restoring a session (`prefix s` → Enter, or `:restore <name>`) works the same
way — **replaces the window you invoked it from** — it opens the session's
tabs there, then closes whatever was open before, rather than spawning a
separate window. If that
session is already open in another window, though, it's an *attach*, not a
recreate: both `prefix N`/`:session <name>` and restoring switch to the
window that's already running it instead of spinning up a duplicate — the
same way `tmux attach` doesn't relaunch a session that's already up. And like
a tmux session dying when its last pane closes: if you close all of a live
session's tabs yourself (closing the window, basically) instead of using
`prefix d`, the saved session is deleted, not left behind as a stale entry.
`detach` is the deliberate exception — it always saves before it closes, so
that save is never the one that gets thrown away.

tabmux doesn't manage window layout — for side-by-side tabs, use Chrome's
own built-in Split View (drag a tab to the window edge, or right-click a tab
→ split). Chrome doesn't currently expose an extension API to drive Split
View programmatically ([w3c/webextensions#967](https://github.com/w3c/webextensions/issues/967)
is the open request for one), so that stays a native, manual gesture and
tabmux focuses on what it *can* script well: tabs, groups, and sessions.

## Install (build once, then load unpacked)

The source under `src/` is real ES modules (`import`/`export`); esbuild bundles
each entry point into the single flat file Chrome actually loads (Chrome
supports ES modules natively for the background service worker, but **not**
for declared content scripts, so content.js has to be pre-bundled).

1. `npm install`
2. `npm run build` — produces `dist/`, or use `npm run watch` while developing
   to rebuild automatically on save.
3. Go to `chrome://extensions`.
4. Toggle **Developer mode** (top right).
5. Click **Load unpacked** and select the tabmux **`dist/`** folder — not the
   repo root, `dist/` is the actual extension package.
6. Open any normal web page and hit your prefix (default **Ctrl-b**), then `?`.

After changing anything under `src/`: re-run `npm run build` (or leave
`npm run watch` running), then hit the reload icon (⟳) for tabmux on
`chrome://extensions`, and refresh any tab you're testing in.

To change the prefix (e.g. to Ctrl-a): right-click the extension → **Options**.

## Keybindings

Press the prefix, then:

```
c            new tab (stays in the current tab group, if any)
x            close tab
n / p        next / previous tab
1-9          jump to tab N (within the current tab group, if the
                            active tab is in one — else window-wide)
Tab  or  ;   last tab

g / G        next / previous tab group
t            tab group picker  (j/k move · enter jump · a add tab ·
                                 n new · r rename · c collapse · x close)
S            send tab to group  (same picker · enter files this tab
                                  there · n new group · esc cancel)
B            break tab out of its group

N            new session  (tmux `new -s <name>`: opens a fresh window
                            named <name> and autosaves it as you go)
s            session picker  (j/k move · enter restore · d delete)
d            detach: save this window's tabs, then close it
:            command prompt: session <name> | save [name] | restore <name> |
                              kill <name> | group <name> | ungroup | new

[            copy/scroll mode
?            help overlay
```

Copy mode: `j k` line, `d u` half-page, `space b` page, `g G` top/bottom,
`/` search, `n` next match, `q`/`Esc` exit.

## Known limitations

- **Won't run on `chrome://` pages, the Web Store, or the New Tab Page.** Chrome
  forbids content scripts there, so the prefix does nothing on those pages.
  Switch to a normal page first.
- The prefix is captured in capture phase and should win on most pages, but a
  site with an aggressive same-chord handler could still interfere. Remap the
  prefix in Options if a site fights you.

## Project structure

```
src/
├── manifest.json           MV3 manifest and permissions (copied as-is to dist/)
├── background/             service worker — one file per concern
│   ├── index.js              message listener + dispatch table
│   ├── tabs.js                cycle/select/last-tab + recent-tab tracking
│   ├── groups.js               tab-group operations
│   └── sessions.js              new/save/list/restore/delete + detach
├── content/                 content script — bundled into one file for Chrome
│   ├── main.js                entry point: wires config + the keydown listener
│   ├── mode.js                 prefix/command-mode state machine
│   ├── keymap.js                the CMDS table (single source of truth) + help
│   ├── copy-mode.js             vim-ish scroll/search mode
│   ├── config.js                user settings, synced from chrome.storage
│   ├── state.js                  shared mode/overlay state
│   ├── messaging.js               send/sendAsync to the background worker
│   ├── utils.js                    escapeHtml/div/timeAgo
│   └── ui/
│       ├── shell.js                 shadow-DOM host + CSS
│       ├── status.js                 status bar + toast
│       ├── overlay.js                 generic overlay lifecycle + input prompt
│       ├── session-picker.js           `prefix s`
│       ├── group-picker.js              `prefix t`
│       └── prompts.js                    `prefix N`, `prefix d`, `prefix :`
└── options/
    ├── options.html
    └── options.js

scripts/build.mjs   esbuild bundler (background/index.js, content/main.js,
                     options/options.js → dist/*.js; copies manifest + html)
dist/                build output — load THIS folder as the unpacked extension
```

Each background/content file owns exactly one concern. `background/index.js`
and `content/main.js` are the only "composition root" files — everything else
is a plain module imported from there (or transitively).
