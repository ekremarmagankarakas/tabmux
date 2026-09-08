import { it, expect } from 'vitest';
import { defaultBindings, helpCommands } from '../../../src/shared/commands.js';

it('combines the nine default tab jumps into a single help row', () => {
  const rows = helpCommands(defaultBindings()).filter(row => row.label.startsWith('jump to tab'));
  expect(rows).toEqual([{label:'jump to tab 1–9',keys:['1–9']}]);
});
it.each([[['z']], [['1','z']], [[]]])('keeps customized tab jumps explicit: %j', keys => {
  const bindings = defaultBindings(); bindings['select-tab-1'] = keys;
  const rows = helpCommands(bindings).filter(row => row.label.startsWith('jump to tab'));
  expect(rows).toHaveLength(9);
  expect(rows[0]).toEqual({label:'jump to tab 1',keys});
  expect(rows.some(row => row.keys.includes('1–9'))).toBe(false);
});
