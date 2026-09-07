import { describe, it, expect, beforeEach, vi } from "vitest";
import { openOverlay, closeOverlay, openInput } from "../../../src/content/ui/overlay.js";
import { activeOverlay, setActiveOverlay } from "../../../src/content/state.js";

beforeEach(() => {
  // Best-effort reset: shell.js's shadow root is a module-level singleton
  // that outlives individual tests, so a leftover overlay from a failed
  // prior test would otherwise linger as an orphan in the shared root.
  if (activeOverlay) closeOverlay();
  setActiveOverlay(null);
});

it("appends the element and tracks it as the active overlay", () => {
  const el = document.createElement("div");
  openOverlay(el);
  expect(activeOverlay.el).toBe(el);
  expect(el.isConnected).toBe(true);
});

it("closeOverlay is a safe no-op with nothing open", () => {
  expect(() => closeOverlay()).not.toThrow();
});

// Regression: two async openers (e.g. two quick prefix-d presses, each
// awaiting a background round trip before rendering) used to both eventually
// call openOverlay — the second silently overwrote the activeOverlay
// reference, stranding the first element in the shadow DOM with no way to
// close it (its own Escape handler read the now-wrong activeOverlay).
it("closes a still-open overlay instead of stranding it when a second one opens", () => {
  const first = document.createElement("div");
  openOverlay(first);
  expect(first.isConnected).toBe(true);

  const second = document.createElement("div");
  openOverlay(second);

  expect(first.isConnected).toBe(false);
  expect(activeOverlay.el).toBe(second);
});

describe("openInput", () => {
  it("submits the current input value and closes on Enter", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    openInput("lead:", "prefill", onSubmit, onCancel);

    const input = activeOverlay.el.querySelector("input");
    expect(input.value).toBe("prefill");
    input.value = "typed value";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith("typed value");
    expect(onCancel).not.toHaveBeenCalled();
    expect(activeOverlay).toBeNull();
  });

  it("cancels and closes on Escape without submitting", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    openInput("lead:", "", onSubmit, onCancel);

    const input = activeOverlay.el.querySelector("input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(activeOverlay).toBeNull();
  });
});
