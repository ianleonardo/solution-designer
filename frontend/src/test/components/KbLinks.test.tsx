import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { KbSectionToolbar } from "../../components/KbLinks";
import type { Project, Section } from "../../types";

const project: Project = {
  project_id: "p1",
  project_name: "Cards",
  description: "",
  countries: ["SG"],
  systems: [],
  owner_id: "u",
  owner_name: "a",
  owner_role: "Analyst",
  created_at: "",
  last_modified: "",
};

const capability = (id: string, country: string, l3: string) => ({
  capability_id: id, country, system_code: "SPL", l1_capability: "Pay", l2_capability: "Card", l3_capability: l3,
  description: "", processing_rules: "", created_at: "", last_modified: "",
});

const emptySection: Section = { template_id: "inventory-of-capabilities", title: "Inventory of Capabilities", blocks: [{ type: "table", columns: ["SN", "App Name"], rows: [["1", ""]] }], missing: [] };
let calls: { url: string; method: string; body: string }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: String(init?.body ?? "") });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url === "/api/capabilities") return json([capability("c-sg", "SG", "Auth"), capability("c-my", "MY", "Settle"), capability("c-all", "", "Refund")]);
      if (url === "/api/catalogs") return json({ countries: ["SG", "MY"], databases: [], interface_channels: [] });
      if (url === "/api/systems") return json([]);
      if (url.endsWith("/kb-links")) return json({ document_id: "d1", content_json: { sections: {} } });
      if (url.endsWith("/kb-related"))
        return json([{ section_id: "interfaces-summary", section_title: "Interfaces Summary", source: "interfaces", items: [{ id: "i1", label: "Balance" }] }]);
      return json({});
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

test("adds capabilities in the project scope, then offers the related interfaces", async () => {
  const onDocument = vi.fn();
  const beforeChange = vi.fn(async () => undefined);
  render(
    <KbSectionToolbar
      base="/api/projects/p1/documents/d1"
      sectionId="inventory-of-capabilities"
      source="capabilities"
      section={emptySection}
      project={project}
      readOnly={false}
      beforeChange={beforeChange}
      onDocument={onDocument}
      onError={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Add from Knowledge Base/ }));
  const picker = await screen.findByRole("dialog", { name: "Add capabilities from the Knowledge Base" });
  // project scope is SG: the MY-only capability is filtered out, the all-country one stays
  expect(await within(picker).findByText("Pay › Card › Auth")).toBeTruthy();
  expect(within(picker).getByText("Pay › Card › Refund")).toBeTruthy();
  expect(within(picker).queryByText("Pay › Card › Settle")).toBeNull();
  expect(within(picker).getByRole("button", { name: "Filter by country" }).textContent).toContain("Project scope (SG)");

  fireEvent.click(within(picker).getByRole("checkbox", { name: "Select Pay › Card › Auth" }));
  fireEvent.click(within(picker).getByRole("button", { name: "Add 1 selected" }));
  const related = await screen.findByRole("dialog", { name: "Add related items" });
  expect(beforeChange).toHaveBeenCalled();
  const first = calls.find((call) => call.url.endsWith("/sections/inventory-of-capabilities/kb-links"))!;
  expect(JSON.parse(first.body)).toEqual({ ids: ["c-sg"] });
  expect(within(related).getByRole("checkbox", { name: "Interfaces Summary: Balance" })).toBeTruthy();
  fireEvent.click(within(related).getByRole("button", { name: "Add 1 related" }));
  await waitFor(() => expect(calls.some((call) => call.url.endsWith("/sections/interfaces-summary/kb-links"))).toBe(true));
  const second = calls.find((call) => call.url.endsWith("/sections/interfaces-summary/kb-links"))!;
  expect(JSON.parse(second.body)).toEqual({ ids: ["i1"] });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add related items" })).toBeNull());
  expect(onDocument).toHaveBeenCalledTimes(2);
});

test("shows how many linked rows changed and refreshes them", async () => {
  const onDocument = vi.fn();
  const linked: Section = {
    ...emptySection,
    blocks: [{ type: "table", columns: ["SN", "App Name"], rows: [["1", "SPL"]], links: [{ kind: "capability", id: "c-sg", owned: [1], values: { "1": "SPL" }, state: "changed" }] }],
  };
  render(
    <KbSectionToolbar
      base="/api/projects/p1/documents/d1"
      sectionId="inventory-of-capabilities"
      source="capabilities"
      section={linked}
      project={project}
      readOnly={false}
      beforeChange={async () => undefined}
      onDocument={onDocument}
      onError={vi.fn()}
    />,
  );
  expect(screen.getByText("1 changed since added")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Refresh from Knowledge Base/ }));
  await waitFor(() => expect(calls.some((call) => call.url.endsWith("/kb-refresh") && call.method === "POST")).toBe(true));
  await waitFor(() => expect(onDocument).toHaveBeenCalled());
});
