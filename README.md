# tabmux

Drive Chrome from the keyboard like tmux: a **prefix key**, **modal commands**,
**panes**, and **saved sessions**. Built for people who live in tmux/Neovim and
tile their windows (this maps cleanly onto an Aerospace-style workflow).

## Model

| tmux            | tabmux                                              |
|-----------------|-----------------------------------------------------|
| window          | Chrome tab                                           |
| pane            | tiled Chrome **window** (see note)                   |
| session         | a named, saved set of tabs                           |
| prefix (`C-b`)  | prefix chord, then a command key                     |
| copy mode       | vim-ish scroll/search mode on the current page       |

**Why panes are windows, not iframe splits:** the tempting approach — embedding
pages as iframes side-by-side inside one tab — breaks on most real sites, which
send `X-Frame-Options: DENY` or `frame-ancestors 'none'` (Google, GitHub, banks,
etc.), and it reloads the page into the frame, losing JS state. Tiling real
browser windows via the `windows` API works on every site and behaves like a
tiling WM. If you specifically want in-tab iframe splits for embeddable-only
pages, that's a swappable strategy — see "Alternative pane model" below.

## Install (unpacked)

1. Unzip this folder somewhere permanent.
2. Go to `chrome://extensions`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the `tabmux` folder.
5. Open any normal web page and hit your prefix (default **Ctrl-b**), then `?`.

To change the prefix (e.g. to Ctrl-a): right-click the extension → **Options**.

## Keybindings

Press the prefix, then:

```
c            new tab
x            close tab
n / p        next / previous tab
1-9          jump to tab N
Tab  or  ;   last tab

%            split panes  ↔  (new window, left/right)
"            split panes  ↕  (new window, top/bottom)
o            focus next pane
h j k l      focus pane by direction
↑ ↓ ← →      focus pane by direction
z            zoom pane (maximize toggle)
E            tile all panes into a grid

s            session picker  (j/k move · enter restore · d delete)
d            detach: save this window's tabs, then close it
:            command prompt: save <name> | restore <name> | kill <name> | new

[            copy/scroll mode
?            help overlay
```

Copy mode: `j k` line, `d u` half-page, `space b` page, `g G` top/bottom,
`/` search, `n` next match, `q`/`Esc` exit.

## Known limitations

- **Won't run on `chrome://` pages, the Web Store, or the New Tab Page.** Chrome
  forbids content scripts there, so the prefix does nothing on those pages.
  Switch to a normal page first.
- **Directional pane focus is geometric**, based on window centers — it works
  well for clean splits, less well for heavily overlapping windows.
- **Multi-monitor:** splits/tiling use the display the current window sits on.
- The prefix is captured in capture phase and should win on most pages, but a
  site with an aggressive same-chord handler could still interfere. Remap the
  prefix in Options if a site fights you.

## Alternative pane model (iframe splits)

If you want the tmux-visual "multiple panes in one tab" look and only browse
embeddable sites, the split handler in `background.js` can be replaced with a
content-script overlay that injects `<iframe>`s. It's a drop-in change to the
`split` / `focus-window` message handlers; ping me and I'll wire it up.

## Files

- `manifest.json` — MV3 manifest and permissions
- `background.js` — tab ops, window tiling, sessions
- `content.js` — modal command layer, copy mode, all overlays
- `options.html` / `options.js` — prefix + behavior settings
