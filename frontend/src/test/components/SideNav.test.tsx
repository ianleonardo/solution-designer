import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SideNav } from "../../components/SideNav";

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
    expect(screen.getByRole("button", { name: "Audit Log" }).getAttribute("class")).toContain("bg-cobalt");
    unmount();
    render(
      <MemoryRouter>
        <SideNav role="Analyst" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Audit Log" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: /Knowledge Base/ }));
    expect(screen.queryByRole("button", { name: "Screens" })).toBeNull();
    for (const label of ["Systems", "Capabilities", "Interfaces", "Tables", "Batches", "Reports", "Bitbucket Repositories", "Guidelines"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("opens the settings submenu for the current route", () => {
    render(
      <MemoryRouter initialEntries={["/settings/users"]}>
        <SideNav role="Admin" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "LLM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Document Layouts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Users" }).getAttribute("class")).toContain("bg-cobalt");
  });

  it("closes Settings when Knowledge Base is opened (accordion)", () => {
    render(
      <MemoryRouter initialEntries={["/settings/users"]}>
        <SideNav role="Admin" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Users" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Knowledge Base/ }));
    expect(screen.getByRole("button", { name: "Tables" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Users" })).toBeNull();
  });

  it("hides every menu the role has no access to and lists User Roles under Settings", () => {
    render(
      <MemoryRouter initialEntries={["/settings/users"]}>
        <SideNav permissions={{ projects: "none", knowledge: "none", settings: "read" }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.queryByText("Project Documents")).toBeNull();
    expect(screen.queryByRole("button", { name: /Knowledge Base/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Settings/ })).toBeTruthy();
    expect(screen.getByText("User Roles")).toBeTruthy();
  });
});
