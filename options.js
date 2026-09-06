const KEY = "tabmux:config";
const DEF = { prefix: { ctrl: true, alt: false, shift: false, key: "b" }, timeoutMs: 2500, alwaysShowStatus: false };

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get(KEY);
  const c = { ...DEF, ...(s[KEY] || {}) };
  $("ctrl").checked = !!c.prefix.ctrl;
  $("alt").checked = !!c.prefix.alt;
  $("shift").checked = !!c.prefix.shift;
  $("key").value = c.prefix.key || "b";
  $("timeout").value = c.timeoutMs;
  $("always").checked = !!c.alwaysShowStatus;
}

async function save() {
  const cfg = {
    prefix: {
      ctrl: $("ctrl").checked,
      alt: $("alt").checked,
      shift: $("shift").checked,
      key: ($("key").value || "b").toLowerCase()
    },
    timeoutMs: Math.max(500, Math.min(10000, parseInt($("timeout").value, 10) || 2500)),
    alwaysShowStatus: $("always").checked
  };
  await chrome.storage.local.set({ [KEY]: cfg });
  const ok = $("ok");
  ok.classList.add("show");
  setTimeout(() => ok.classList.remove("show"), 1200);
}

$("save").addEventListener("click", save);
load();
