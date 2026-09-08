import { describe, it, expect, beforeEach, vi } from "vitest";
import { config, DEFAULTS } from "../../../src/content/config.js";
import { mode, setMode, setActiveOverlay } from "../../../src/content/state.js";
import { onKeyDown } from "../../../src/content/mode.js";

function key(props) {
  return {
    ...props,
    isTrusted: props.isTrusted ?? true,
    key: props.key,
    ctrlKey: !!props.ctrlKey,
    altKey: !!props.altKey,
    shiftKey: !!props.shiftKey,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

beforeEach(() => {
  globalThis.chrome = { runtime: { sendMessage: vi.fn((_,cb) => cb({ok:true})), lastError: undefined } };
  setMode("normal");
  setActiveOverlay(null);
  Object.assign(config, structuredClone(DEFAULTS), { prefix: { ...DEFAULTS.prefix } });
});

describe("prefix matching", () => {
  it("enters command mode on the configured prefix chord", () => {
    onKeyDown(key({ key: "b", ctrlKey: true }));
    expect(mode).toBe("command");
  });

  it("ignores the prefix key without its modifier", () => {
    onKeyDown(key({ key: "b" }));
    expect(mode).toBe("normal");
  });
});

describe("command dispatch", () => {
  // Regression: a bare modifier keydown on its way to typing a shifted key
  // (e.g. Shift before "E") used to be looked up in CMDS, fail to match, and
  // fall through to exitCommand() — kicking you out of command mode before
  // the actual key you were pressing ever arrived.
  it("a bare modifier keydown mid-chord doesn't exit command mode", () => {
    onKeyDown(key({ key: "b", ctrlKey: true }));
    onKeyDown(key({ key: "Shift", shiftKey: true }));
    expect(mode).toBe("command");
  });

  it("an unrecognized key exits command mode", () => {
    onKeyDown(key({ key: "b", ctrlKey: true }));
    onKeyDown(key({ key: "z" }));
    expect(mode).toBe("normal");
  });

  it("a plain command sends its message and exits command mode", () => {
    onKeyDown(key({ key: "b", ctrlKey: true }));
    onKeyDown(key({ key: "c" }));
    expect(mode).toBe("normal");
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "new-tab" }),
      expect.any(Function),
    );
  });

  it("a `stays: true` command (help) stays in command mode", () => {
    onKeyDown(key({ key: "b", ctrlKey: true }));
    onKeyDown(key({ key: "?" }));
    expect(mode).toBe("command");
  });

  it("Escape exits command mode", () => {
    onKeyDown(key({ key: "b", ctrlKey: true }));
    onKeyDown(key({ key: "Escape" }));
    expect(mode).toBe("normal");
  });

  it("a digit selects a tab by index and exits", () => {
    onKeyDown(key({ key: "b", ctrlKey: true }));
    onKeyDown(key({ key: "5" }));
    expect(mode).toBe("normal");
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "select-tab", index: 5 }),
      expect.any(Function),
    );
  });
});

describe("command-mode timeout", () => {
  it("auto-exits after the configured timeout with no further key", () => {
    vi.useFakeTimers();
    onKeyDown(key({ key: "b", ctrlKey: true }));
    expect(mode).toBe("command");
    vi.advanceTimersByTime(config.timeoutMs + 10);
    expect(mode).toBe("normal");
    vi.useRealTimers();
  });
});

describe('keyboard safety', () => {
  it('ignores synthetic prefix and command events', () => {
    onKeyDown(key({key:'b',ctrlKey:true,isTrusted:false}));
    expect(mode).toBe('normal');
    onKeyDown(key({key:'b',ctrlKey:true}));
    onKeyDown(key({key:'x',isTrusted:false}));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it('matches Meta explicitly', () => {
    onKeyDown(key({key:'b',ctrlKey:true,metaKey:true})); expect(mode).toBe('normal');
    config.prefix = {key:'b',meta:true};
    onKeyDown(key({key:'b',metaKey:true})); expect(mode).toBe('command');
  });
  it('ignores composition and repeated destructive commands', () => {
    onKeyDown(key({key:'b',ctrlKey:true,isComposing:true})); expect(mode).toBe('normal');
    onKeyDown(key({key:'b',ctrlKey:true}));
    onKeyDown(key({key:'x',repeat:true}));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('custom command bindings', () => {
  it('dispatches a new binding and stops recognizing the old key', () => {
    config.bindings['new-tab'] = ['o','O'];
    onKeyDown(key({key:'b',ctrlKey:true})); onKeyDown(key({key:'c'}));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    onKeyDown(key({key:'b',ctrlKey:true})); onKeyDown(key({key:'O',shiftKey:true}));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({type:'new-tab'},expect.any(Function));
  });
  it('remaps tab jumps through the same dispatcher', () => {
    config.bindings['select-tab-1'] = ['z'];
    onKeyDown(key({key:'b',ctrlKey:true})); onKeyDown(key({key:'z'}));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({type:'select-tab',index:1},expect.any(Function));
  });
  it('does not dispatch unbound commands or modified digit keys', () => {
    config.bindings['close-tab'] = [];
    onKeyDown(key({key:'b',ctrlKey:true})); onKeyDown(key({key:'x'}));
    onKeyDown(key({key:'b',ctrlKey:true})); onKeyDown(key({key:'1',metaKey:true}));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
