// tabmux — content script entry point.
// Bootstraps config, then attaches the single top-level keydown listener that
// drives everything else (see mode.js). Bundled by scripts/build.mjs into the
// flat dist/content.js Chrome actually loads.
import { initConfig, config } from "./config.js";
import { showStatus, idleStatus } from "./ui/status.js";
import { onKeyDown } from "./mode.js";

initConfig(() => {
  if (config.alwaysShowStatus) showStatus(idleStatus());
});

window.addEventListener("keydown", onKeyDown, true);
