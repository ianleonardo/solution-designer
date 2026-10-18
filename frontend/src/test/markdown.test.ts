import { describe, expect, it } from "vitest";
import { renderCell, safeLink } from "../markdown";

describe("markdown helpers", () => {
  it("renders one line inline and several lines as blocks", () => {
    expect(renderCell("a **b**")).toBe("a <strong>b</strong>");
    expect(renderCell("- a\n- b")).toContain("<ul>");
    expect(renderCell("  ")).toBe("");
  });

  it("escapes HTML", () => {
    expect(renderCell("<b>x</b>")).toContain("&lt;b&gt;");
  });

  it("accepts web and mail links, adds https to bare addresses and refuses other schemes", () => {
    expect(safeLink(" https://a.com ")).toBe("https://a.com");
    expect(safeLink("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeLink("a.com/x")).toBe("https://a.com/x");
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("data:text/html,x")).toBeNull();
    expect(safeLink("  ")).toBeNull();
  });
});
