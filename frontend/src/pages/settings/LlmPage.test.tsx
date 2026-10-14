import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LlmPage } from "./LlmPage";
import type { Settings } from "../../types";

const base = { chat_base_url: "", embedding_model: "", embedding_base_url: "", updated_at: "now", embedding_api_key_configured: false };
let settings: Settings;
let calls: { url: string; method: string; body: string }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("localStorage", { getItem: () => null });
  settings = {
    active_provider: "spirare",
    global_system_prompt: "Be precise",
    updated_at: "now",
    providers: [
      { ...base, provider: "gemini", label: "Gemini", chat_model: "gemini-2.5-flash", api_key_configured: false },
      { ...base, provider: "anthropic", label: "Anthropic", chat_model: "claude", api_key_configured: false },
      { ...base, provider: "spirare", label: "Spirare", chat_model: "gpt", api_key_configured: true },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: String(init?.body ?? "") });
      if (url === "/api/settings" && method === "PUT") {
        const body = JSON.parse(String(init?.body));
        settings = { ...settings, active_provider: body.active_provider, global_system_prompt: body.global_system_prompt };
        return new Response(JSON.stringify(settings), { status: 200 });
      }
      if (url.startsWith("/api/settings/providers/")) {
        const name = url.split("/").pop();
        const body = JSON.parse(String(init?.body));
        const provider = settings.providers.find((item) => item.provider === name)!;
        return new Response(JSON.stringify({ ...provider, chat_model: body.chat_model ?? provider.chat_model, api_key_configured: Boolean(body.api_key) || provider.api_key_configured }), { status: 200 });
      }
      return new Response(JSON.stringify(settings), { status: 200 });
    }),
  );
});

afterEach(cleanup);

test("shows three providers with write-only key inputs", async () => {
  render(<LlmPage />);
  await screen.findByRole("form", { name: "Gemini settings" });
  expect(screen.getByRole("form", { name: "Anthropic settings" })).toBeTruthy();
  expect(screen.getByRole("form", { name: "Spirare settings" })).toBeTruthy();
  const keys = screen.getAllByLabelText(/^API key/) as HTMLInputElement[];
  expect(keys).toHaveLength(3);
  keys.forEach((input) => {
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
  });
  expect(screen.getByText("(configured)")).toBeTruthy();
});

test("saving a provider sends the key and clears the input", async () => {
  render(<LlmPage />);
  const form = await screen.findByRole("form", { name: "Gemini settings" });
  const input = form.querySelector('input[type="password"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value: "secret-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Gemini" }));
  await waitFor(() => expect(calls.some((call) => call.url === "/api/settings/providers/gemini")).toBe(true));
  const call = calls.find((item) => item.url === "/api/settings/providers/gemini")!;
  expect(call.method).toBe("PUT");
  expect(JSON.parse(call.body).api_key).toBe("secret-1");
  await waitFor(() => expect(input.value).toBe(""));
});

test("choosing another provider activates it", async () => {
  render(<LlmPage />);
  await screen.findByRole("form", { name: "Gemini settings" });
  fireEvent.click(screen.getByLabelText("Use Gemini as active provider"));
  await waitFor(() => expect(calls.some((call) => call.url === "/api/settings" && call.method === "PUT")).toBe(true));
  const put = calls.find((call) => call.url === "/api/settings" && call.method === "PUT")!;
  expect(JSON.parse(put.body).active_provider).toBe("gemini");
});

function stubWithReindex(statuses: object[]) {
  const queue = [...statuses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/reindex/status") return new Response(JSON.stringify(queue.length > 1 ? queue.shift() : queue[0]), { status: 200 });
      return new Response(JSON.stringify(settings), { status: 200 });
    }),
  );
}

test("shows the re-index progress while it runs, then the result", async () => {
  const idle = { total: 0, done: 0, failed: 0, started_at: null, finished_at: null };
  stubWithReindex([
    { ...idle, running: true, total: 840, done: 120, message: "" },
    { ...idle, running: false, total: 840, done: 840, message: "Re-indexed 840 items." },
  ]);
  render(<LlmPage />);
  expect((await screen.findByText(/Re-indexing the knowledge base… 120 of 840/)).getAttribute("role")).toBe("status");
  await waitFor(() => expect(screen.getByText("Re-indexed 840 items.")).toBeTruthy(), { timeout: 5000 });
  expect(screen.queryByText(/Re-indexing the knowledge base/)).toBeNull();
});

test("shows nothing about re-indexing when it has never run", async () => {
  stubWithReindex([{ running: false, total: 0, done: 0, failed: 0, started_at: null, finished_at: null, message: "" }]);
  render(<LlmPage />);
  await screen.findByRole("form", { name: "Gemini settings" });
  expect(screen.queryByText(/Re-index/)).toBeNull();
});
