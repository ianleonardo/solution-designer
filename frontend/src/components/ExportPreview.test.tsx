import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportPreview, splitMermaid } from "./ExportPreview";

vi.mock("./DiagramBlock", () => ({
  MermaidPreview: ({ source }: { source: string }) => <div data-testid="diagram">{source}</div>,
}));

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: string, type: string) {
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "Content-Type": type } })));
}

describe("splitMermaid", () => {
  it("separates mermaid fences from markdown", () => {
    const parts = splitMermaid("# Title\n\n```mermaid\nflowchart LR\n  A-->B\n```\n\nAfter");
    expect(parts.map((part) => part.kind)).toEqual(["markdown", "mermaid", "markdown"]);
    expect(parts[1].text).toBe("flowchart LR\n  A-->B");
  });
});

describe("ExportPreview", () => {
  it("renders generated markdown as a formatted view with Download and Close", async () => {
    stubFetch("# Fixed Deposit\n\n## Scope\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n  A-->B\n```\n", "text/markdown");
    render(<ExportPreview projectId="p1" projectName="Fixed Deposit" format="md" onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Fixed Deposit" })).toBeTruthy());
    expect(screen.getByRole("heading", { level: 2, name: "Scope" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByTestId("diagram").textContent).toContain("flowchart LR");
    expect(screen.queryByText(/^# Fixed Deposit/)).toBeNull();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("does not inject raw html from markdown", async () => {
    stubFetch("<img src=x onerror=alert(1)>\n", "text/markdown");
    const { container } = render(<ExportPreview projectId="p1" projectName="x" format="md" onClose={() => undefined} />);
    await waitFor(() => expect(container.ownerDocument.querySelector(".md-preview")).toBeTruthy());
    expect(container.ownerDocument.querySelector(".md-preview img")).toBeNull();
  });

  it("shows a line break in a table cell as a line break, not as <br> text", async () => {
    stubFetch("| A |\n| --- |\n| satu<br>\u2022 dua<br/>\u2022 tiga |\n\nA literal &lt;br&gt; stays text, and <b>raw</b> html stays off.\n", "text/markdown");
    const { container } = render(<ExportPreview projectId="p1" projectName="x" format="md" onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    const cell = container.ownerDocument.querySelector(".md-preview td")!;
    expect(cell.querySelectorAll("br")).toHaveLength(2);
    expect(cell.textContent).toBe("satu\n\u2022 dua\n\u2022 tiga");
    expect(cell.innerHTML).not.toContain("&lt;br");
    expect(container.ownerDocument.querySelector(".md-preview b")).toBeNull();
  });

  it("shows the server error when the export fails", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Could not build the PDF." }), { status: 500, headers: { "Content-Type": "application/json" } })));
    render(<ExportPreview projectId="p1" projectName="x" format="pdf" onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText("Could not build the PDF.")).toBeTruthy());
  });
});
