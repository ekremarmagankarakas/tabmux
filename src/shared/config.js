import { defaultBindings, normalizeBindings } from './commands.js';
export const CONFIG_KEY = 'tabmux:config';
export const DEFAULTS = { prefix: { ctrl:true, alt:false, shift:false, meta:false, key:'b' }, timeoutMs:2500, alwaysShowStatus:false, bindings:defaultBindings() };
export function normalizeConfig(value = {}) {
  const p = value?.prefix || {};
  return {
    prefix: { ...Object.fromEntries(['ctrl','alt','shift','meta'].map(k => [k, typeof p[k] === 'boolean' ? p[k] : DEFAULTS.prefix[k]])), key: typeof p.key === 'string' && [...p.key].length === 1 ? p.key.toLowerCase() : 'b' },
    timeoutMs: Number.isFinite(value?.timeoutMs) ? Math.max(500,Math.min(10000,value.timeoutMs)) : 2500,
    alwaysShowStatus: value?.alwaysShowStatus === true,
    bindings: normalizeBindings(value?.bindings),
  };
}
