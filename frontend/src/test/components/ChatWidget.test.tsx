import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatWidget } from "../../components/ChatWidget";

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

test("dragging the title bar moves the window and header buttons do not", () => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  renderChat();
  const panel = screen.getByRole("region", { name: "Chat with analyst" });
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 200,
    width: 420,
    height: 480,
    right: 520,
    bottom: 680,
    x: 100,
    y: 200,
    toJSON() {
      return {};
    },
  });
  Object.defineProperty(panel, "offsetWidth", { configurable: true, value: 420 });
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 480 });

  const header = screen.getByText("Chat with analyst").parentElement as HTMLElement;
  fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 120, clientY: 214 });
  fireEvent.pointerMove(header, { pointerId: 1, clientX: 180, clientY: 260 });
  fireEvent.pointerUp(header, { pointerId: 1, clientX: 180, clientY: 260 });
  expect(panel.style.left).toBe("160px");
  expect(panel.style.top).toBe("246px");

  fireEvent.pointerDown(screen.getByLabelText("Close chat"), { button: 0, pointerId: 2, clientX: 400, clientY: 210 });
  fireEvent.pointerMove(header, { pointerId: 2, clientX: 10, clientY: 10 });
  expect(panel.style.left).toBe("160px");
  expect(panel.style.top).toBe("246px");
});

test("dragging a corner resizes the window and does not shrink it below the minimum", () => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  renderChat();
  const panel = screen.getByRole("region", { name: "Chat with analyst" });
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 80,
    width: 420,
    height: 480,
    right: 520,
    bottom: 560,
    x: 100,
    y: 80,
    toJSON() {
      return {};
    },
  });
  const corner = screen.getByRole("button", { name: "Resize bottom right" });
  fireEvent.pointerDown(corner, { button: 0, pointerId: 1, clientX: 520, clientY: 560 });
  fireEvent.pointerMove(corner, { pointerId: 1, clientX: 570, clientY: 600 });
  expect(panel.style.width).toBe("470px");
  expect(panel.style.height).toBe("520px");
  fireEvent.pointerUp(corner, { pointerId: 1, clientX: 570, clientY: 600 });

  const right = screen.getByRole("button", { name: "Resize right" });
  fireEvent.pointerDown(right, { button: 0, pointerId: 2, clientX: 520, clientY: 300 });
  fireEvent.pointerMove(right, { pointerId: 2, clientX: 200, clientY: 300 });
  expect(panel.style.width).toBe("280px");
  expect(panel.style.height).toBe("480px");
});

test("the chat window is titled Chat with analyst", () => {
  renderChat();
  expect(screen.getByText("Chat with analyst")).toBeTruthy();
  expect(screen.queryByText("Project chat")).toBeNull();
  expect(screen.getByLabelText("Clear chat")).toBeTruthy();
  expect(screen.getByLabelText("Close chat")).toBeTruthy();
});

test("follow-up sends prior turns as history", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.message === "second") {
      expect(body.history).toEqual([
        { role: "user", content: "first" },
        { role: "assistant", content: "reply one" },
      ]);
      return new Response(JSON.stringify({ reply: "reply two", refused: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ reply: "reply one", refused: false }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderChat();
  await ask("first");
  await waitFor(() => expect(screen.getByText("reply one")).toBeTruthy());
  await ask("second");
  await waitFor(() => expect(screen.getByText("reply two")).toBeTruthy());
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("clear chat empties messages and context for the next send", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.message === "after clear") {
      expect(body.history).toEqual([]);
      return new Response(JSON.stringify({ reply: "fresh", refused: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ reply: "old reply", refused: false }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderChat();
  await ask("old question");
  await waitFor(() => expect(screen.getByText("old reply")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Clear chat"));
  expect(screen.queryByText("old question")).toBeNull();
  expect(screen.queryByText("old reply")).toBeNull();
  await ask("after clear");
  await waitFor(() => expect(screen.getByText("fresh")).toBeTruthy());
});

test("copy response writes the assistant text to the clipboard", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reply: "copy me", refused: false }), { status: 200 })));
  renderChat();
  await ask("please answer");
  await waitFor(() => expect(screen.getByLabelText("Copy response")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Copy response"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("copy me"));
});
