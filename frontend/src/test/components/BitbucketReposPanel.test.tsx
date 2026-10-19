import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { BitbucketReposPanel } from "../../components/BitbucketReposPanel";

const projects = ["CORE", "SPL", "DBE", "PIB", "PIBVN2", "PIBID", "SOF", "WSM", "NTN"];

const repo = (id: string, project: string, name: string) => ({
  repo_id: id,
  bitbucket_project: project,
  repo_name: name,
  description: `${name} description`,
  main_components: `${name} parts`,
  created_at: "2026-10-18T00:00:00",
  last_modified: "2026-10-18T00:00:00",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderAt(path = "/knowledge/bitbucket") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BitbucketReposPanel />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

test("shows a tab per Bitbucket project and loads that project's repositories", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  const core = [repo("r1", "CORE", "payment-api"), ...Array.from({ length: 50 }, (_, index) => repo(`extra-${index}`, "CORE", `extra-${index}`))];
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG"], databases: [], interface_channels: [], bitbucket_projects: projects }));
    if (url === "/api/bitbucket-repos/CORE") return Promise.resolve(json(core));
    if (url === "/api/bitbucket-repos/SOF") return Promise.resolve(json([repo("r2", "SOF", "notify-svc")]));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/knowledge/bitbucket?tab=sof");
  await waitFor(() => expect(screen.getByRole("tab", { name: "NTN" })).toBeTruthy());
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(projects);
  expect(screen.getByRole("tab", { name: "SOF" }).getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(screen.getByText("notify-svc")).toBeTruthy());
  expect(screen.queryByText("payment-api")).toBeNull();
  expect(screen.queryByRole("columnheader", { name: /System/ })).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "CORE" }));
  await waitFor(() => expect(screen.getByText("payment-api")).toBeTruthy());
  expect(screen.queryByText("notify-svc")).toBeNull();
  expect(screen.getByLabelText("Pagination").textContent).toContain("1-25 of 51");
  fireEvent.change(screen.getByLabelText("Search CORE repositories"), { target: { value: "payment-api" } });
  expect(screen.getByText("payment-api")).toBeTruthy();
  expect(screen.queryByText("extra-0")).toBeNull();
  expect(fetchMock.mock.calls.map((call) => call[0]).filter((url) => String(url).startsWith("/api/bitbucket-repos/"))).toEqual([
    "/api/bitbucket-repos/SOF",
    "/api/bitbucket-repos/CORE",
  ]);
});

test("uploads an Excel file to the current project tab", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/catalogs") return Promise.resolve(json({ countries: [], databases: [], interface_channels: [], bitbucket_projects: projects }));
    if (init?.method === "POST" && url === "/api/bitbucket-repos/CORE/upload") return Promise.resolve(json([repo("r9", "CORE", "uploaded-repo")]));
    if (url === "/api/bitbucket-repos/CORE") return Promise.resolve(json([]));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt();
  await waitFor(() => expect(screen.getByRole("tab", { name: "CORE" })).toBeTruthy());
  expect(screen.queryByLabelText("System")).toBeNull();
  const file = new File(["xlsx"], "repos.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  fireEvent.change(screen.getByLabelText("Upload CORE Excel"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText("uploaded-repo")).toBeTruthy());
  expect(screen.getByRole("status").textContent).toBe("CORE now has 1 repository.");
  const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST");
  expect(post?.[0]).toBe("/api/bitbucket-repos/CORE/upload");
  const body = (post?.[1] as RequestInit).body as FormData;
  expect(body.get("system")).toBeNull();
  expect((body.get("file") as File).name).toBe("repos.xlsx");
});

test("opens a repository row in a detail popup and saves main components", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  const row = repo("r1", "CORE", "payment-api");
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/catalogs") return Promise.resolve(json({ countries: [], databases: [], interface_channels: [], bitbucket_projects: projects }));
    if (init?.method === "PATCH") return Promise.resolve(json({ ...row, main_components: "API gateway" }));
    if (url === "/api/bitbucket-repos/CORE") return Promise.resolve(json([row]));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderAt();
  await waitFor(() => expect(screen.getByRole("heading", { name: "Bitbucket Repositories" })).toBeTruthy());
  await waitFor(() => expect(screen.getByText("payment-api")).toBeTruthy());
  expect(screen.queryByRole("columnheader", { name: "Main components" })).toBeNull();
  expect(within(screen.getByRole("columnheader", { name: "Description" })).queryByRole("button")).toBeNull();
  expect(screen.getByRole("button", { name: "Edit payment-api" }).className).toContain("icon-btn");
  expect(screen.getByRole("button", { name: "Delete payment-api" }).className).toContain("icon-btn");

  fireEvent.click(screen.getByRole("button", { name: "Edit payment-api" }));
  expect(screen.getByRole("dialog", { name: "Edit repository" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Repository detail" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  fireEvent.click(screen.getByText("payment-api"));
  const dialog = screen.getByRole("dialog", { name: "Repository detail" });
  expect(within(dialog).getByText("payment-api description")).toBeTruthy();
  expect(within(dialog).getByRole("textbox", { name: "Main components" })).toBeTruthy();
  expect(within(dialog).getByRole("toolbar", { name: "Main components formatting" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save components" }));
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/bitbucket-repos/CORE/r1");
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ main_components: "payment-api parts" });
  });
});
