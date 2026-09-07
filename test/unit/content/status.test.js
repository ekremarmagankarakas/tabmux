import { describe, it, expect, beforeEach } from "vitest";
import { config, DEFAULTS } from "../../../src/content/config.js";
import { prefixLabel } from "../../../src/content/ui/status.js";

beforeEach(() => {
  Object.assign(config, structuredClone(DEFAULTS), { prefix: { ...DEFAULTS.prefix } });
});

describe("prefixLabel", () => {
  it("formats the configured modifiers and key", () => {
    config.prefix = { ctrl: true, alt: true, shift: false, key: "b" };
    expect(prefixLabel()).toBe("C-A-b");
  });

  // Regression: prefixLabel() is interpolated straight into innerHTML at
  // every call site (the status bar and the help overlay) — the options
  // page's prefix-key field has no charset filter beyond lowercasing, so a
  // user-chosen key of "<" used to produce broken markup in their own status
  // bar/help overlay. Self-inflicted only, but cheap to just not allow.
  it("escapes HTML-significant characters in a user-chosen prefix key", () => {
    config.prefix = { ctrl: true, alt: false, shift: false, key: "<" };
    expect(prefixLabel()).toBe("C-&lt;");
  });
});
