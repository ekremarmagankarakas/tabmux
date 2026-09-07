import { describe, it, expect } from "vitest";
import { div, escapeHtml, timeAgo } from "../../../src/content/utils.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<b>"a" & 'b'</b>`)).toBe("&lt;b&gt;&quot;a&quot; &amp; 'b'&lt;/b&gt;");
  });
  it("passes plain text through unchanged", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
});

describe("div", () => {
  it("builds an element with the given class and innerHTML", () => {
    const el = div("<span>hi</span>", "panel");
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("panel");
    expect(el.innerHTML).toBe("<span>hi</span>");
  });
  it("omits the class when none is given", () => {
    const el = div("text");
    expect(el.className).toBe("");
  });
});

describe("timeAgo", () => {
  const now = Date.now();
  it.each([
    [now - 5_000, "5s"],
    [now - 90_000, "1m"],
    [now - 2 * 3_600_000, "2h"],
    [now - 3 * 86_400_000, "3d"],
  ])("formats %i as %s", (ts, expected) => {
    expect(timeAgo(ts)).toBe(expected);
  });
});
