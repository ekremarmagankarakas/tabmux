import { describe, it, expect, beforeEach, vi } from "vitest";
import { config, DEFAULTS } from "../../../src/content/config.js";
import { mode, setMode, setActiveOverlay } from "../../../src/content/state.js";
import { onKeyDown } from "../../../src/content/mode.js";

function key(props) {
  return {
    key: props.key,
    ctrlKey: !!props.ctrlKey,
    altKey: !!props.altKey,
    shiftKey: !!props.shiftKey,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

beforeEach(() => {
  globalThis.chrome = { runtime: { sendMessage: vi.fn(), lastError: undefined } };
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
