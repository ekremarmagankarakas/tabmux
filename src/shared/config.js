import { defaultBindings, normalizeBindings } from './commands.js';
export const CONFIG_KEY = 'tabmux:config';
export const DEFAULTS = { prefix: { ctrl:true, alt:false, shift:false, meta:false, key:'b' }, timeoutMs:2500, alwaysShowStatus:false, sessionReplaceDefault:false, bindings:defaultBindings() };
export function normalizeConfig(value = {}) {
  const p = value?.prefix || {};
  return {
    prefix: { ...Object.fromEntries(['ctrl','alt','shift','meta'].map(k => [k, typeof p[k] === 'boolean' ? p[k] : DEFAULTS.prefix[k]])), key: typeof p.key === 'string' && [...p.key].length === 1 ? p.key.toLowerCase() : 'b' },
    timeoutMs: Number.isFinite(value?.timeoutMs) ? Math.max(500,Math.min(10000,value.timeoutMs)) : 2500,
    alwaysShowStatus: value?.alwaysShowStatus === true,
    // New/restore session default: false = open in a new window and minimize
    // the current one (non-destructive); true = replace the current window's
    // tabs in place. Either way, shift+enter/the `!` command suffix always
    // gets you the *other* one — see session-picker.js / prompts.js.
    sessionReplaceDefault: value?.sessionReplaceDefault === true,
    bindings: normalizeBindings(value?.bindings),
  };
}
