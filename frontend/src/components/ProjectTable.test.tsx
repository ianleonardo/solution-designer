import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import { ProjectTable } from "./ProjectTable";

const project: Project = {
  project_id: "p1",
  project_name: "Fixed Deposit",
  description: "FD product",
  owner_id: "u1",
  owner_name: "Write",
  owner_role: "Write",
  created_at: "2026-10-13T00:00:00",
  last_modified: "2026-10-13T00:00:00",
};

function renderTable(role: "Write" | "Read", onChanged = () => undefined) {
  return render(
    <MemoryRouter>
      <ProjectTable projects={[project]} role={role} onChanged={onChanged} />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("ProjectTable", () => {
  it("shows icon actions for editing, opening and deleting", () => {
    renderTable("Write");
    expect(screen.getByRole("button", { name: "Edit Fixed Deposit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open document Fixed Deposit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Fixed Deposit" })).toBeTruthy();
  });

  it("paginates at 30 projects and sorts by name when the header is clicked", () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ ...project, project_id: `p${index}`, project_name: `Project ${String(index).padStart(2, "0")}` }));
    render(
      <MemoryRouter>
        <ProjectTable projects={many} role="Write" onChanged={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText("1-30 of 31")).toBeTruthy();
    expect(screen.queryByText("Project 30")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Project Name/ }));
    fireEvent.click(screen.getByRole("button", { name: /Project Name/ }));
    expect(screen.getAllByRole("row")[1].textContent).toContain("Project 30");
  });

  it("asks for confirmation before deleting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { getItem: () => null });
    const onChanged = vi.fn();
    renderTable("Write", onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Delete Fixed Deposit" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/p1");
  });

  it("hides edit and delete for viewers", () => {
    renderTable("Read");
    expect(screen.queryByRole("button", { name: "Edit Fixed Deposit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Fixed Deposit" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open document Fixed Deposit" })).toBeTruthy();
  });

  it("edits the name and description in a dialog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    const onChanged = vi.fn();
    renderTable("Write", onChanged);

    fireEvent.click(screen.getByRole("button", { name: "Edit Fixed Deposit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit project" });
    expect(dialog).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "FD Vietnam" } });
    fireEvent.change(screen.getByLabelText("Project description"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/p1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ project_name: "FD Vietnam", description: "Updated" });
  });
});
