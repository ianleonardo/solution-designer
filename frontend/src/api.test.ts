import { describe, expect, it } from "vitest";
import { formatDate } from "./api";

describe("formatDate", () => {
  it("formats as DD-MMM YYYY", () => {
    expect(formatDate("2026-10-13T12:00:00Z")).toBe("13-Oct 2026");
    expect(formatDate("2026-01-05T12:00:00")).toBe("05-Jan 2026");
  });

  it("shows a dash for empty values and keeps unparseable text", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not a date")).toBe("not a date");
  });
});
