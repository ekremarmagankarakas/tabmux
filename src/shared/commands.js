// Stable command IDs keep saved preferences independent of labels and default keys.
export const COMMANDS = [
  { id: 'new-tab', label: 'new tab', group: 'tabs', keys: ['c'] },
  { id: 'close-tab', label: 'close tab', group: 'tabs', keys: ['x'] },
  { id: 'next-tab', label: 'next tab', group: 'tabs', keys: ['n'] },
  { id: 'prev-tab', label: 'previous tab', group: 'tabs', keys: ['p'] },
  { id: 'last-tab', label: 'last tab', group: 'tabs', keys: ['Tab', ';'] },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `select-tab-${i + 1}`, label: `jump to tab ${i + 1}`, group: 'tab jumps', keys: [String(i + 1)],
  })),
  { id: 'group-next', label: 'next tab group', group: 'groups', keys: ['g'] },
  { id: 'group-prev', label: 'previous tab group', group: 'groups', keys: ['G'] },
  { id: 'group-create', label: 'new tab group', group: 'groups', keys: ['T'] },
  { id: 'group-picker', label: 'tab group picker', group: 'groups', keys: ['t'] },
  { id: 'send-to-group', label: 'send tab to group', group: 'groups', keys: ['S'] },
  { id: 'group-remove', label: 'break from tab group', group: 'groups', keys: ['B'] },
  { id: 'session-picker', label: 'session picker', group: 'sessions', keys: ['s'] },
  { id: 'new-session', label: 'new session', group: 'sessions', keys: ['N'] },
  { id: 'detach', label: 'detach (save + close)', group: 'sessions', keys: ['d'] },
  { id: 'command-prompt', label: 'command prompt', group: 'modes and help', keys: [':'] },
  { id: 'copy-mode', label: 'copy / scroll mode', group: 'modes and help', keys: ['['] },
  { id: 'help', label: 'help', group: 'modes and help', keys: ['?'] },
];

export function defaultBindings() {
  return Object.fromEntries(COMMANDS.map(command => [command.id, [...command.keys]]));
}

const NAMED_KEYS = ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete', 'Insert'];

export function normalizeKey(value) {
  if (typeof value !== 'string') throw new Error('Enter one key, such as c, G, Tab, or Space');
  if (value === ' ') return ' ';
  const key = value.trim();
  if (!key) return null;
  if ([...key].length === 1 && !/\s|\p{C}/u.test(key)) return key;
  const named = NAMED_KEYS.find(name => name.toLowerCase() === key.toLowerCase());
  if (named) return named === 'Space' ? ' ' : named;
  if (/^(escape|esc|enter)$/i.test(key)) throw new Error('Escape and Enter are reserved for cancel');
  throw new Error('Use one character or a named key: Tab, Space, arrows, Home, End, PageUp, PageDown, Backspace, Delete, Insert');
}

export function keyLabel(key) { return key === ' ' ? 'Space' : key; }

// Missing IDs inherit defaults for upgrades. Empty arrays deliberately unbind.
export function validateBindings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid command bindings');
  const bindings = {};
  const owners = new Map();
  for (const command of COMMANDS) {
    const raw = Object.hasOwn(value, command.id) ? value[command.id] : command.keys;
    if (!Array.isArray(raw) || raw.length > 2) throw new Error(`${command.label}: choose at most two keys`);
    const keys = raw.map(key => {
      try { return normalizeKey(key); }
      catch (error) { throw new Error(`${command.label}: ${error.message}`); }
    }).filter(key => key !== null);
    for (const key of keys) {
      if (owners.has(key)) throw new Error(`${keyLabel(key)} is assigned to both ${owners.get(key)} and ${command.label}`);
      owners.set(key, command.label);
    }
    bindings[command.id] = keys;
  }
  return bindings;
}

export function normalizeBindings(value) {
  // Preserve a pre-existing custom T binding when upgrading to the new command.
  if (value && typeof value === 'object' && !Object.hasOwn(value, 'group-create') &&
      Object.values(value).some(keys => Array.isArray(keys) && keys.includes('T'))) {
    value = { ...value, 'group-create': [] };
  }
  try { return validateBindings(value); }
  catch { return defaultBindings(); }
}

export function commandForKey(bindings, key) {
  return COMMANDS.find(command => bindings[command.id]?.includes(key));
}

// Only collapse the range when every digit still has exactly its default job.
// Custom or disabled tab jumps remain explicit so help never misstates a binding.
export function helpCommands(bindings) {
  const jumps = COMMANDS.filter(command => command.group === 'tab jumps');
  const combine = jumps.every(command => {
    const keys = bindings[command.id];
    return keys?.length === 1 && keys[0] === command.keys[0];
  });
  return COMMANDS.flatMap(command => {
    if (combine && command.group === 'tab jumps') {
      return command.id === 'select-tab-1'
        ? [{ label: 'jump to tab 1–9', keys: ['1–9'] }]
        : [];
    }
    return [{ label: command.label, keys: bindings[command.id] || [] }];
  });
}
