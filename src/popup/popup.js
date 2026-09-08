import { CONFIG_KEY, normalizeConfig } from '../shared/config.js';
const $ = id => document.getElementById(id);
let tab;
let sessions = [];
let busy = false;
let sessionReplaceDefault = false;
// Click carries the modifier state (shift+click, or shift held on a
// keyboard-triggered click) — shift always gets the *other* behavior from
// whatever the configured default currently is, same split as the content
// script's session picker / command prompt.
const sessionReplace = modified => sessionReplaceDefault ? !modified : modified;
async function request(msg) {
  const result = await chrome.runtime.sendMessage({ ...msg, tabId:tab?.id });
  if (!result || result.error) throw new Error(result?.error || 'No response from tabmux');
  return result;
}
function failure(message) { $('failure').hidden = false; $('error').textContent = message; }
async function run(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await fn(); }
  catch (e) {
    const result = await request({type:'get-save-status'}).catch(() => null);
    $('retry').hidden = !result?.status?.name && !result?.status?.pendingName;
    failure(e.message);
  }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function renderSessions() {
  const matches = sessions.filter(s => s.name.toLowerCase().includes($('filter').value.toLowerCase()));
  $('sessions').replaceChildren();
  if (!matches.length) { const p = document.createElement('p'); p.textContent = sessions.length ? 'No matching sessions.' : 'No sessions yet. Save this window below.'; $('sessions').appendChild(p); }
  const hint = sessionReplaceDefault ? 'shift+click: open in a new window instead' : 'shift+click: replace this window instead';
  for (const s of matches) $('sessions').appendChild(row(s.name, s.count, e => run(async () => {
    const result = await request({type:'restore-session', name:s.name, replace:sessionReplace(e.shiftKey)});
    $('notice').textContent = result.toast; await refresh();
  }), hint));
}
function row(name,count,action,hint) {
  const button = document.createElement('button'); button.className = 'session';
  const title = document.createElement('span'); title.textContent = name;
  const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = `${count} ${count === 1 ? 'tab' : 'tabs'}`;
  if (hint) button.title = hint;
  button.append(title,meta); button.addEventListener('click',action); return button;
}
async function refresh() {
  const [list,statusResult,recovery] = await Promise.all([request({type:'list-sessions'}),request({type:'get-save-status'}),request({type:'list-recovery'})]);
  const state = statusResult.status;
  sessions = list.sessions;
  $('current').textContent = state.name ? `current: ${state.name}` : 'current: unnamed window';
  $('name').value = state.name || '';
  $('failure').hidden = !state.error;
  $('retry').hidden = !state.name && !state.pendingName;
  if (state.error) failure(state.error);
  renderSessions();
  $('recoveries').replaceChildren();
  for (const s of recovery.recoveries) $('recoveries').appendChild(row(`${s.name} · ${new Date(s.savedAt).toLocaleString()}`,s.count,() => run(async () => {
    const result = await request({type:'restore-recovery',recoveryId:s.id});
    $('notice').textContent = result.toast; await refresh();
  })));
  if (!recovery.recoveries.length) $('recoveries').textContent = 'No replaced windows yet.';
}
$('filter').addEventListener('input',renderSessions);
$('sessions').addEventListener('keydown',e => {
  if (!['ArrowDown','ArrowUp','j','k'].includes(e.key)) return;
  e.preventDefault();
  const buttons = [...$('sessions').querySelectorAll('button')];
  const next = (buttons.indexOf(document.activeElement) + (['ArrowDown','j'].includes(e.key)?1:-1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
});
$('filter').addEventListener('keydown',e => { if (e.key === 'ArrowDown') {e.preventDefault(); $('sessions').querySelector('button')?.focus();} });
for (const [id,type] of [['save','save-session'],['new','new-session']]) $(id).addEventListener('click',e => run(async () => {
  const name = $('name').value.trim();
  if (!name) { $('name').focus(); throw new Error('Enter a session name first'); }
  const extra = type === 'new-session' ? {replace:sessionReplace(e.shiftKey)} : {};
  const result = await request({type,name,...extra}); $('notice').textContent = result.toast; await refresh();
}));
$('retry').addEventListener('click',() => run(async () => { await request({type:'retry-save'}); await refresh(); }));
$('options').addEventListener('click',() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((msg,sender) => {
  if (sender.id === chrome.runtime.id && msg.type === 'save-status' && msg.windowId === tab?.windowId) run(refresh);
});
run(async () => {
  [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab) throw new Error('No active tab in this window');
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  sessionReplaceDefault = normalizeConfig(stored[CONFIG_KEY]).sessionReplaceDefault;
  $('new').title = sessionReplaceDefault
    ? 'shift+click: open in a new window instead of replacing this one'
    : 'shift+click: replace this window instead of opening a new one';
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find(c => c.name === '_execute_action')?.shortcut;
  $('shortcut').textContent = shortcut ? `${shortcut} · open from any tab, including New Tab` : 'Set a shortcut at chrome://extensions/shortcuts';
  await refresh();
});
