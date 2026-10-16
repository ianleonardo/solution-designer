import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SideNav } from "./SideNav";

describe("SideNav", () => {
  it("shows Project Documents and Knowledge Base to a Viewer, and hides Settings", () => {
    render(
      <MemoryRouter>
        <SideNav role="Viewer" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Project Documents")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Knowledge Base/ })).toBeTruthy();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Audit Log")).toBeNull();
  });

  it("gives the Audit Log to an admin only", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/settings/audit"]}>
        <SideNav role="Admin" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Audit Log" }).getAttribute("class")).toContain("bg-cobalt");
    unmount();
    render(
      <MemoryRouter>
        <SideNav role="Analyst" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Audit Log" })).toBeNull();
  });

  it("shows knowledge base and settings groups to an admin", () => {
    render(
      <MemoryRouter>
        <SideNav role="Admin" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /Settings/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Knowledge Base/ })).toBeTruthy();
  });

  it("expands the knowledge base submenu with every inventory type", () => {
    render(
      <MemoryRouter>
        <SideNav role="Admin" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Screens" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Knowledge Base/ }));
    for (const label of ["Systems", "Capabilities", "Interfaces", "Tables", "Screens", "Batches", "Reports", "Guidelines"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
  });

  it("opens the settings submenu for the current route", () => {
    render(
      <MemoryRouter initialEntries={["/settings/users"]}>
        <SideNav role="Admin" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "LLM" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Document Layouts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("class")).toContain("bg-cobalt");
  });
});
