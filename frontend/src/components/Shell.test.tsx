import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Shell } from "./Shell";
import { ThemeProvider } from "../theme";

vi.mock("../auth", () => ({
  useAuth: () => ({ user: { login_id: "maker", role_name: "Maker" }, logout: () => undefined }),
}));

beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderShell() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<p>page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

test("the top bar has no chat icon; chat opens from the floating button", () => {
  renderShell();
  expect(screen.queryByRole("button", { name: "Toggle chat" })).toBeNull();
  expect(screen.getByRole("button", { name: "Toggle theme" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
  expect(screen.getByText("Chat with analyst")).toBeTruthy();
});
