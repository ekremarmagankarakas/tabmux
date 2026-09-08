import { it, expect } from 'vitest';
import { defaultBindings, normalizeBindings, validateBindings, commandForKey } from '../../../src/shared/commands.js';
import { normalizeConfig } from '../../../src/shared/config.js';

it('adds command defaults to old configurations without changing the prefix', () => {
  const config = normalizeConfig({prefix:{ctrl:false,alt:true,key:'t'}});
  expect(config.prefix).toMatchObject({ctrl:false,alt:true,key:'t'});
  expect(config.bindings['last-tab']).toEqual(['Tab',';']);
  expect(config.bindings['select-tab-9']).toEqual(['9']);
});
it('supports alternates, case-sensitive keys, named keys, and explicit unbinding', () => {
  const bindings = validateBindings({'new-tab':['o','O'],'close-tab':[],'next-tab':['arrowright'],'prev-tab':['Space']});
  expect(commandForKey(bindings,'o').id).toBe('new-tab');
  expect(commandForKey(bindings,'O').id).toBe('new-tab');
  expect(commandForKey(bindings,'ArrowRight').id).toBe('next-tab');
  expect(commandForKey(bindings,' ').id).toBe('prev-tab');
  expect(commandForKey(bindings,'x')).toBeUndefined();
});
it('rejects conflicts with default commands and tab jumps', () => {
  expect(() => validateBindings({'new-tab':['n']})).toThrow(/both new tab and next tab/);
  expect(() => validateBindings({'new-tab':['1']})).toThrow(/jump to tab 1/);
  expect(() => validateBindings({'last-tab':['tab','Tab']})).toThrow(/both last tab/);
});
it.each(['Escape','Enter','Ctrl+c','Shift','ab'])('rejects unsupported or reserved binding %s', key => {
  expect(() => validateBindings({'new-tab':[key]})).toThrow();
});
it('falls back safely for corrupt stored bindings', () => {
  expect(normalizeBindings({'new-tab':null})).toEqual(defaultBindings());
  expect(normalizeBindings({'new-tab':['n']})).toEqual(defaultBindings());
});
it('can move a digit to another command when its original command is unbound', () => {
  const bindings = validateBindings({'new-tab':['1'],'select-tab-1':[]});
  expect(commandForKey(bindings,'1').id).toBe('new-tab');
});
it('adds prefix T without replacing a pre-existing custom T binding', () => {
  const legacy = defaultBindings(); delete legacy['group-create'];
  expect(normalizeBindings(legacy)['group-create']).toEqual(['T']);
  legacy['new-tab'] = ['T'];
  const migrated = normalizeBindings(legacy);
  expect(migrated['new-tab']).toEqual(['T']);
  expect(migrated['group-create']).toEqual([]);
});
it('defaults N to new session and S to send-to-group without changing saved choices', () => {
  const defaults = defaultBindings();
  expect(commandForKey(defaults,'N').id).toBe('new-session');
  expect(commandForKey(defaults,'S').id).toBe('send-to-group');
  const saved = {...defaults,'new-session':['S'],'send-to-group':['N']};
  expect(normalizeBindings(saved)).toEqual(saved);
});
