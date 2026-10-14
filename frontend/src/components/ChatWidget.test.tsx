import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatWidget } from "./ChatWidget";

const reply = [
  "1.  **Secure Design and Architecture:**",
  "    *   **Threat Modeling:** Identify threats *early*.",
  "    *   **Defense in Depth:** Use multiple layers.",
  "",
  "2.  **Secure Coding Practices:**",
].join("\n");

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderChat() {
  return render(
    <MemoryRouter>
      <ChatWidget open onOpen={() => undefined} />
    </MemoryRouter>,
  );
}

async function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

test("assistant replies render markdown as bold, italic and lists", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reply, refused: false }), { status: 200 })));
  const { container } = renderChat();
  await ask("how to have good secure code?");
  await waitFor(() => expect(container.querySelector(".chat-md")).not.toBeNull());
  const bubble = container.querySelector(".chat-md") as HTMLElement;
  expect(Array.from(bubble.querySelectorAll("strong")).map((item) => item.textContent)).toContain("Threat Modeling:");
  expect(bubble.querySelector("em")?.textContent).toBe("early");
  expect(bubble.querySelectorAll("ol > li").length).toBe(2);
  expect(bubble.querySelectorAll("ul > li").length).toBe(2);
  expect(bubble.textContent).not.toContain("**");
});

test("raw html in a reply is shown as text, not injected", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reply: "<img src=x onerror=alert(1)> **ok**", refused: false }), { status: 200 })));
  const { container } = renderChat();
  await ask("is this safe for the api?");
  await waitFor(() => expect(container.querySelector(".chat-md")).not.toBeNull());
  expect(container.querySelector(".chat-md img")).toBeNull();
  expect(container.querySelector(".chat-md strong")?.textContent).toBe("ok");
});

test("user messages stay plain text", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reply: "fine", refused: false }), { status: 200 })));
  const { container } = renderChat();
  await ask("what is **this** api");
  await waitFor(() => expect(container.querySelector(".chat-md")).not.toBeNull());
  expect(screen.getByText("what is **this** api")).toBeTruthy();
});

test("the chat window is titled Chat with analyst", () => {
  renderChat();
  expect(screen.getByText("Chat with analyst")).toBeTruthy();
  expect(screen.queryByText("Project chat")).toBeNull();
});
