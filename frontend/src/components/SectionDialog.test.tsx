import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ApiError } from "../api";
import { SectionDialog } from "./SectionDialog";
import type { Template } from "../types";

afterEach(cleanup);

const template: Template = {
  layout_id: "sdd",
  template_id: "scope",
  parent_id: null,
  section_name: "Scope",
  sequence_order: 100,
  system_prompt: "Write the scope",
  temperature: 0.3,
  max_words: 400,
  content_kind: "prose",
  hint: "Short",
  blocks: [{ type: "prose" }],
};

test("a new section needs a name and sends a default block without a prompt", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<SectionDialog mode={{ kind: "add", parentName: "Architecture" }} onSubmit={onSubmit} onClose={() => undefined} />);
  expect(screen.getByRole("dialog", { name: "Add sub-section to Architecture" })).toBeTruthy();
  const add = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Section name"), { target: { value: " Caching " } });
  fireEvent.click(add);
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  const sent = onSubmit.mock.calls[0][0];
  expect(sent.section_name).toBe("Caching");
  expect(sent.blocks).toEqual([{ type: "prose" }]);
  expect("system_prompt" in sent).toBe(false);
  expect(sent.max_words).toBe(2000);
});

test("editing shows the current values, lets the blocks change and sends everything", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<SectionDialog mode={{ kind: "edit", template }} onSubmit={onSubmit} onClose={() => undefined} />);
  expect((screen.getByLabelText("Section name") as HTMLInputElement).value).toBe("Scope");
  expect((screen.getByLabelText("Section prompt") as HTMLTextAreaElement).value).toBe("Write the scope");
  expect((screen.getByLabelText("Max words") as HTMLInputElement).value).toBe("400");
  fireEvent.click(screen.getByRole("button", { name: /Table/ }));
  fireEvent.change(screen.getByLabelText("Section prompt"), { target: { value: "New prompt" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  const sent = onSubmit.mock.calls[0][0];
  expect(sent.blocks.map((block: { type: string }) => block.type)).toEqual(["prose", "table"]);
  expect(sent.system_prompt).toBe("New prompt");
  expect(sent.temperature).toBe(0.3);
  expect(sent.hint).toBe("Short");
});

test("an empty prompt is refused when editing and server errors are shown", async () => {
  const onSubmit = vi.fn().mockRejectedValue(new ApiError(400, "A table needs at least one named column"));
  render(<SectionDialog mode={{ kind: "edit", template }} onSubmit={onSubmit} onClose={() => undefined} />);
  fireEvent.change(screen.getByLabelText("Section prompt"), { target: { value: " " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText("The section prompt is required.")).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Section prompt"), { target: { value: "ok" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByText("A table needs at least one named column")).toBeTruthy());
});
