import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Outline, type OutlineEditor } from "../../components/Outline";

afterEach(cleanup);

describe("Outline", () => {
  it("marks sections that are missing required information", () => {
    render(
      <Outline
        active="nfr"
        onSelect={() => undefined}
        items={[
          { id: "nfr", name: "Key Non-Functional Requirements", depth: 0, missing: 2 },
          { id: "principles", name: "Design Principles", depth: 0, missing: 0 },
        ]}
      />,
    );
    expect(screen.getByText("Missing information")).toBeTruthy();
    expect(screen.getByText("Key Non-Functional Requirements")).toBeTruthy();
    expect(screen.getByText("Design Principles")).toBeTruthy();
  });

  describe("edit structure", () => {
    const items = [
      { id: "intro", name: "Introduction", depth: 0, missing: 0 },
      { id: "purpose", name: "Purpose", depth: 1, missing: 0 },
      { id: "scope", name: "Scope", depth: 0, missing: 0 },
    ];

    function editorMock(): OutlineEditor {
      return { onRename: vi.fn(), onMove: vi.fn(), onIndent: vi.fn(), onOutdent: vi.fn(), onDelete: vi.fn(), onSettings: vi.fn(), onAdd: vi.fn() };
    }

    function open(editor: OutlineEditor, onSelect = vi.fn()) {
      render(<Outline active="intro" onSelect={onSelect} items={items} editor={editor} />);
      fireEvent.click(screen.getByRole("button", { name: /Edit structure/ }));
      return onSelect;
    }

    it("has no edit switch without an editor", () => {
      render(<Outline active="intro" onSelect={() => undefined} items={items} />);
      expect(screen.queryByRole("button", { name: /Edit structure/ })).toBeNull();
    });

    it("renames a section when the name field loses focus", () => {
      const editor = editorMock();
      open(editor);
      const input = screen.getByLabelText("Section name Scope") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "  Scope and goals " } });
      fireEvent.blur(input);
      expect(editor.onRename).toHaveBeenCalledWith("scope", "Scope and goals");
    });

    it("does not rename to an empty or unchanged name", () => {
      const editor = editorMock();
      open(editor);
      const input = screen.getByLabelText("Section name Scope") as HTMLInputElement;
      fireEvent.change(input, { target: { value: " " } });
      fireEvent.blur(input);
      expect(input.value).toBe("Scope");
      fireEvent.blur(input);
      expect(editor.onRename).not.toHaveBeenCalled();
    });

    it("offers move, indent, outdent, add, settings and delete per row", () => {
      const editor = editorMock();
      const onSelect = open(editor);
      fireEvent.click(screen.getByLabelText("Move down Introduction"));
      expect(editor.onMove).toHaveBeenCalledWith("intro", 1);
      fireEvent.click(screen.getByLabelText("Move up Scope"));
      expect(editor.onMove).toHaveBeenCalledWith("scope", -1);
      fireEvent.click(screen.getByLabelText("Indent Scope"));
      expect(editor.onIndent).toHaveBeenCalledWith("scope");
      fireEvent.click(screen.getByLabelText("Outdent Purpose"));
      expect(editor.onOutdent).toHaveBeenCalledWith("purpose");
      fireEvent.click(screen.getByLabelText("Add sub-section to Introduction"));
      expect(editor.onAdd).toHaveBeenCalledWith("intro");
      fireEvent.click(screen.getByRole("button", { name: /Add section/ }));
      expect(editor.onAdd).toHaveBeenCalledWith(null);
      fireEvent.click(screen.getByLabelText("Settings Purpose"));
      expect(editor.onSettings).toHaveBeenCalledWith("purpose");
      fireEvent.click(screen.getByLabelText("Delete Purpose"));
      expect(editor.onDelete).toHaveBeenCalledWith("purpose");
      fireEvent.focus(screen.getByLabelText("Section name Purpose"));
      expect(onSelect).toHaveBeenCalledWith("purpose");
    });

    it("blocks moves that cannot happen at the ends and sub-sections cannot add sub-sections", () => {
      open(editorMock());
      expect((screen.getByLabelText("Move up Introduction") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByLabelText("Move down Scope") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByLabelText("Indent Introduction") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByLabelText("Add sub-section to Purpose")).toBeNull();
    });

    it("leaves edit mode with Done", () => {
      open(editorMock());
      fireEvent.click(screen.getByRole("button", { name: /Done/ }));
      expect(screen.queryByLabelText("Section name Scope")).toBeNull();
      expect(screen.getByText("Scope")).toBeTruthy();
    });

    it("disables the actions while a change is being saved", () => {
      const editor = { ...editorMock(), busy: true };
      open(editor);
      expect((screen.getByLabelText("Delete Scope") as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
