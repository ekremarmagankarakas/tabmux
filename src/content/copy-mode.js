import { setMode } from './state.js';
import { config } from './config.js';
import { showStatus, hideStatus, idleStatus } from './ui/status.js';
import { openInput } from './ui/overlay.js';
import { trustedKey, focusedElement } from './input.js';
let lastSearch = '';
let target;
let pointerTarget;
export function rememberScrollTarget(e) {
  if (e.isTrusted) pointerTarget = e.composedPath()[0];
}
export function scrollTarget(start = focusedElement()) {
  if ((!start || start === document.body || start === document.documentElement) && pointerTarget?.isConnected) start = pointerTarget;
  for (let el = start; el; el = el.parentElement || el.getRootNode?.().host) {
    if (el instanceof Element && el.scrollHeight > el.clientHeight && /auto|scroll|overlay/.test(getComputedStyle(el).overflowY)) return el;
  }
  return window;
}
export function enterCopyMode() {
  // Keep the page's scroll container while the search prompt owns focus.
  if (!target || (target !== window && !target.isConnected)) target = scrollTarget();
  setMode('copy');
  showStatus('COPY  ·  j k  d u  space b  g G  / n  q:exit');
}
export function exitCopyMode() {
  target = null;
  setMode('normal');
  if (config.alwaysShowStatus) showStatus(idleStatus()); else hideStatus();
}
export function resetCopyTarget() { target = null; }
export function handleCopyKey(e) {
  if (!trustedKey(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  const H = target === window ? window.innerHeight : target?.clientHeight || window.innerHeight;
  const amount = {j:60,k:-60,d:H/2,u:-H/2,' ':H*.9,b:-H*.9,f:H*.9};
  const recognized = Object.hasOwn(amount,e.key) || ['g','G','n','/','q','Escape'].includes(e.key);
  if (!recognized) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.key === 'q' || e.key === 'Escape') return exitCopyMode();
  if (e.key === '/') {
    if (e.repeat) return;
    return openInput('/', '', term => { lastSearch = term; if (term) window.find(term); enterCopyMode(); }, enterCopyMode);
  }
  if (e.key === 'n') { if (lastSearch) window.find(lastSearch); return; }
  const scroller = target || window;
  if (Object.hasOwn(amount,e.key)) scroller.scrollBy({top:amount[e.key],left:0,behavior:'instant'});
  else scroller.scrollTo({top:e.key === 'g' ? 0 : scroller === window ? document.documentElement.scrollHeight : scroller.scrollHeight,behavior:'instant'});
}
