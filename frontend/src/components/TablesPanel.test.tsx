import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KbTableRecord, Role } from "../types";
import { TablesPanel } from "./TablesPanel";

let currentRole: Role = "Analyst";

vi.mock("../auth", () => ({
  useOptionalAuth: () => ({
    user: { user_id: "u1", username: "User", login_id: "user", role_name: currentRole, created_at: "" },
    logout: () => undefined,
  }),
}));

const sampleTable: KbTableRecord = {
  table_id: "t1",
  country: "Singapore",
  database_name: "PIB",
  schema_name: "PIB",
  table_name: "CUSTOMER_ACCOUNT",
  description: "Stores customer account records.",
  column_count: 2,
  created_at: "2026-10-16T00:00:00",
  last_modified: "2026-10-16T00:00:00",
  columns: [
    {
      column_id: "c1",
      table_id: "t1",
      column_name: "ACCOUNT_ID",
      data_type: "VARCHAR(36)",
      is_null: "N",
      primary_key: "Y",
      foreign_key: "",
      description: "Primary account identifier.",
      created_at: "2026-10-16T00:00:00",
      last_modified: "2026-10-16T00:00:00",
    },
  ],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  currentRole = "Analyst";
});

describe("TablesPanel", () => {
  it("groups tables by Country / Database / Schema and opens column details when clicked", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/tables") return Promise.resolve(json([sampleTable]));
      if (url === "/api/tables/t1") return Promise.resolve(json(sampleTable));
      return Promise.resolve(json({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TablesPanel />);
    await waitFor(() => expect(screen.getByText("CUSTOMER_ACCOUNT")).toBeTruthy());
    expect(screen.getByText("Stores customer account records.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "CUSTOMER_ACCOUNT" }));
    const dialog = await screen.findByRole("dialog", { name: "Table CUSTOMER_ACCOUNT" });
    expect(within(dialog).getByText("ACCOUNT_ID")).toBeTruthy();
    expect(within(dialog).getByText("VARCHAR(36)")).toBeTruthy();
    expect(within(dialog).getByText("Primary account identifier.")).toBeTruthy();
  });

  it("hides Upload, Add table, Edit and Delete controls for Viewer role", async () => {
    currentRole = "Viewer";
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json([sampleTable])));

    render(<TablesPanel />);
    await waitFor(() => expect(screen.getByText("CUSTOMER_ACCOUNT")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add table/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit CUSTOMER_ACCOUNT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete CUSTOMER_ACCOUNT" })).toBeNull();
  });

  it("uploads an Excel file and prompts to delete or keep missing DB columns", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/tables/upload" && init?.method === "POST") {
        return Promise.resolve(
          json({
            tables: [sampleTable],
            uploaded_tables: 1,
            uploaded_columns: 1,
            missing_columns: [
              {
                column_id: "c-legacy",
                table_id: "t1",
                table_name: "CUSTOMER_ACCOUNT",
                column_name: "LEGACY_FLAG",
                data_type: "CHAR(1)",
                description: "Old flag",
              },
            ],
          }),
        );
      }
      if (url === "/api/tables/columns/delete-batch" && init?.method === "POST") {
        return Promise.resolve(json({ deleted: 1 }));
      }
      return Promise.resolve(json([sampleTable]));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TablesPanel />);
    await waitFor(() => expect(screen.getByText("CUSTOMER_ACCOUNT")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Upload$/ }));
    const uploadDialog = screen.getByRole("dialog", { name: "Upload tables" });
    fireEvent.change(within(uploadDialog).getByLabelText("Country"), { target: { value: "Malaysia" } });
    fireEvent.change(within(uploadDialog).getByLabelText("Database"), { target: { value: "MBK" } });
    fireEvent.change(within(uploadDialog).getByLabelText("Excel file"), {
      target: { files: [new File(["xlsx"], "tables.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] },
    });
    fireEvent.click(within(uploadDialog).getByRole("button", { name: "Upload file" }));

    const reconcileDialog = await screen.findByRole("dialog", { name: "Columns not in Excel" });
    expect(within(reconcileDialog).getByText("LEGACY_FLAG")).toBeTruthy();
    fireEvent.click(within(reconcileDialog).getByRole("button", { name: /Delete selected/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Columns not in Excel" })).toBeNull());
  });
});
