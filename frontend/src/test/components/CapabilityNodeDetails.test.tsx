import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { CapabilitiesPanel } from "../../components/CapabilitiesPanel";
import { CapabilityNodeWindow } from "../../components/CapabilityNodeDetails";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => ({ diagramType: "sequence" })),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 800 400"></svg>' })),
  },
}));

const base = {
  country: "SG",
  system_code: "SPL",
  description: "",
  processing_rules: "",
  created_at: "2026-10-17T00:00:00",
  last_modified: "2026-10-17T00:00:00",
};
const rows = [
  { ...base, capability_id: "c1", l1_capability: "Payments", l2_capability: "Card", l3_capability: "Auth" },
  { ...base, capability_id: "c2", l1_capability: "Payments", l2_capability: "Card", l3_capability: "Capture" },
  { ...base, capability_id: "c3", l1_capability: "Payments", l2_capability: "Wallet", l3_capability: "Top up" },
];
const l1Node = {
  node_id: "n1",
  country: "",
  system_code: "SPL",
  level: 1,
  l1_capability: "Payments",
  l2_capability: "",
  description: "Everything about **moving money**.",
  country_behavior: "",
  sequence_diagrams: [{ id: "d1", title: "Payments overview", mermaid: "sequenceDiagram\n A->>B: hi" }],
  l3_count: 3,
  created_at: "2026-10-17T00:00:00",
  last_modified: "2026-10-17T00:00:00",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(nodes: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ role_name: "Analyst", username: "a" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/catalogs") return Promise.resolve(json({ countries: ["SG", "MY"], databases: [], interface_channels: [] }));
      if (url === "/api/systems")
        return Promise.resolve(json([{ system_code: "SPL", system_name: "SPL Core", description: "", upstreams: "", downstreams: "", has_batch: false, has_report: false, has_capability: true }]));
      if (url === "/api/capabilities") return Promise.resolve(json(rows));
      if (url.startsWith("/api/capability-nodes?system=SPL")) return Promise.resolve(json(nodes));
      if (url === "/api/capability-nodes" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return Promise.resolve(json({ ...l1Node, ...body, node_id: "new" }));
      }
      if (url === "/api/capability-nodes/rename") return Promise.resolve(json({ renamed: 2, details: 0, new_name: "Cards" }));
      return Promise.resolve(json([]));
    }),
  );
  return calls;
}

test("the hierarchy marks L1/L2 with details and opens them in their own window", async () => {
  stubFetch([l1Node]);
  render(
    <MemoryRouter>
      <CapabilitiesPanel />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /View Hierarchy/ }));
  const tree = await screen.findByLabelText("Capability tree");
  const info = await within(tree).findByRole("button", { name: "Details for L1 Payments" });
  await waitFor(() => expect(info.getAttribute("title")).toBe("View details"));

  // The info button opens the window without expanding the node.
  fireEvent.click(info);
  const window = await screen.findByRole("dialog", { name: "L1 capability details" });
  expect(within(tree).getByRole("button", { name: "Payments" }).getAttribute("aria-expanded")).toBe("false");
  expect(within(window).getByText("All countries")).toBeTruthy();
  expect(within(window).getByText("Card")).toBeTruthy(); // L2 children
  expect(within(window).getByText("Wallet")).toBeTruthy();
  expect(await within(window).findByText("Payments overview")).toBeTruthy();
  expect(within(window).getByRole("button", { name: "Markdown" })).toBeTruthy();
  // From the tree the window is view-only, even for editors.
  for (const name of [/Edit/, /Rename/, /Add details/, /Details for other countries/]) {
    expect(within(window).queryByRole("button", { name })).toBeNull();
  }
  expect(within(window).queryByRole("button", { name: "Delete details" })).toBeNull();
  fireEvent.click(within(window).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "L1 capability details" })).toBeNull());

  // An L2 without details shows the muted icon and offers to add them.
  fireEvent.click(within(tree).getByRole("button", { name: "Payments" }));
  const l2Info = within(tree).getByRole("button", { name: "Details for L2 Card" });
  expect(l2Info.getAttribute("title")).toBe("No details yet");
  fireEvent.click(l2Info);
  const l2Window = await screen.findByRole("dialog", { name: "L2 capability details" });
  expect(await within(l2Window).findByText("No details yet for this L2 capability.")).toBeTruthy();
  expect(within(l2Window).queryByRole("button", { name: /Add details/ })).toBeNull();
  expect(within(l2Window).getByText("Auth")).toBeTruthy();
  expect(within(l2Window).getByText("Capture")).toBeTruthy();
});

test("adding L2 details posts the node, countries and diagrams", async () => {
  const calls = stubFetch([]);
  render(
    <CapabilityNodeWindow
      node={{ systemCode: "SPL", level: 2, l1: "Payments", l2: "Card" }}
      country="SG"
      countries={["SG", "MY"]}
      canEdit
      onClose={() => undefined}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Add details/ }));
  const form = await screen.findByRole("dialog", { name: "Add L2 details" });
  // No other record yet, so it starts at All countries; pick MY only.
  expect((within(form).getByLabelText("All countries") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(form).getByLabelText("MY"));
  fireEvent.click(within(form).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(calls.some((call) => call.url === "/api/capability-nodes" && call.init?.method === "POST")).toBe(true));
  const post = calls.find((call) => call.url === "/api/capability-nodes" && call.init?.method === "POST")!;
  expect(JSON.parse(String(post.init!.body))).toMatchObject({ system_code: "SPL", level: 2, l1_capability: "Payments", l2_capability: "Card", country: "MY", sequence_diagrams: [] });
});

test("viewers see details but no edit, rename or add buttons", async () => {
  stubFetch([l1Node]);
  render(<CapabilityNodeWindow node={{ systemCode: "SPL", level: 1, l1: "Payments", l2: "" }} country="SG" countries={["SG", "MY"]} canEdit={false} onClose={() => undefined} />);
  expect(await screen.findByText("Payments overview")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete details" })).toBeNull();
});

test("rename sends the new name and closes the window", async () => {
  const calls = stubFetch([]);
  const onRenamed = vi.fn();
  const onClose = vi.fn();
  render(
    <CapabilityNodeWindow
      node={{ systemCode: "SPL", level: 2, l1: "Payments", l2: "Card" }}
      country="SG"
      countries={["SG"]}
      canEdit
      onRenamed={onRenamed}
      onClose={onClose}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Rename/ }));
  const dialog = await screen.findByRole("dialog", { name: "Rename L2" });
  fireEvent.change(within(dialog).getByLabelText("New name"), { target: { value: "Cards" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(onRenamed).toHaveBeenCalled());
  expect(onClose).toHaveBeenCalled();
  const post = calls.find((call) => call.url === "/api/capability-nodes/rename")!;
  expect(JSON.parse(String(post.init!.body))).toEqual({ system_code: "SPL", level: 2, l1_capability: "Payments", l2_capability: "Card", new_name: "Cards" });
});

test("the table's L1 and L2 info buttons open the details window, the row still opens L3", async () => {
  stubFetch([l1Node]);
  render(
    <MemoryRouter>
      <CapabilitiesPanel />
    </MemoryRouter>,
  );
  const buttons = await screen.findAllByRole("button", { name: "L2 details: Card" });
  fireEvent.click(buttons[0]);
  const window = await screen.findByRole("dialog", { name: "L2 capability details" });
  expect(within(window).getByText("Payments › Card")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "View capability" })).toBeNull();
  // Editing happens from the table.
  expect(within(window).getByRole("button", { name: /Rename/ })).toBeTruthy();
});
