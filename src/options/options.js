import { CONFIG_KEY as KEY, normalizeConfig } from '../shared/config.js';
import { COMMANDS, defaultBindings, keyLabel, validateBindings } from '../shared/commands.js';

const $ = id => document.getElementById(id);
let loaded = false;
let saving = false;
const fields = new Map();

function renderBindings(bindings) {
  $('bindings').replaceChildren();
  fields.clear();
  for (const group of [...new Set(COMMANDS.map(command => command.group))]) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = group;
    section.appendChild(heading);
    for (const command of COMMANDS.filter(command => command.group === group)) {
      const row = document.createElement('div'); row.className = 'binding-row';
      const label = document.createElement('span'); label.textContent = command.label;
      row.appendChild(label);
      const inputs = [0, 1].map(index => {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `binding-${command.id}-${index}`;
        input.setAttribute('aria-label', `${command.label} ${index === 0 ? 'primary' : 'alternate'} key`);
        input.setAttribute('aria-describedby', 'binding-hint binding-error');
        input.autocomplete = 'off'; input.spellcheck = false;
        input.placeholder = index === 0 ? 'unbound' : 'optional';
        input.value = bindings[command.id][index] === undefined ? '' : keyLabel(bindings[command.id][index]);
        row.appendChild(input);
        return input;
      });
      fields.set(command.id, inputs);
      section.appendChild(row);
    }
    $('bindings').appendChild(section);
  }
}

function readBindings() {
  return validateBindings(Object.fromEntries([...fields].map(([id, inputs]) => [id, inputs.map(input => input.value)])));
}

function validate() {
  let error = '';
  try { readBindings(); } catch (e) { error = e.message; }
  $('binding-error').textContent = error;
  $('save').disabled = !loaded || saving || !!error;
  return !error;
}

async function load() {
  const stored = await chrome.storage.local.get(KEY);
  const config = normalizeConfig(stored[KEY]);
  for (const modifier of ['ctrl', 'alt', 'shift', 'meta']) $(modifier).checked = config.prefix[modifier];
  $('key').value = config.prefix.key;
  $('timeout').value = config.timeoutMs;
  $('always').checked = config.alwaysShowStatus;
  $('sessionReplace').checked = config.sessionReplaceDefault;
  renderBindings(config.bindings);
  loaded = true;
  $('reset-bindings').disabled = false;
  validate();
}

function report(message) {
  $('ok').textContent = message;
  $('ok').classList.add('show');
}

async function save() {
  if (!loaded || saving || !validate()) return;
  const config = {
    prefix: {
      ...Object.fromEntries(['ctrl', 'alt', 'shift', 'meta'].map(key => [key, $(key).checked])),
      key: ($('key').value || 'b').toLowerCase(),
    },
    timeoutMs: Math.max(500, Math.min(10000, parseInt($('timeout').value, 10) || 2500)),
    alwaysShowStatus: $('always').checked,
    sessionReplaceDefault: $('sessionReplace').checked,
    bindings: readBindings(),
  };
  saving = true;
  document.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
  try {
    await chrome.storage.local.set({ [KEY]: config });
    renderBindings(config.bindings);
    report('saved ✓');
  } catch (error) {
    report(`Not saved: ${error.message}`);
  } finally {
    saving = false;
    document.querySelectorAll('input, button').forEach(el => { el.disabled = false; });
    validate();
  }
}

$('save').addEventListener('click', save);
$('reset-bindings').addEventListener('click', () => {
  renderBindings(defaultBindings());
  validate();
  report('Default command keys restored. Save to apply.');
});
document.addEventListener('input', () => {
  if (!loaded) return;
  validate();
  report('unsaved changes');
});
$('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(error => report(error.message)));
load().catch(error => report(`Could not load settings: ${error.message}. Reload this page to retry.`));
