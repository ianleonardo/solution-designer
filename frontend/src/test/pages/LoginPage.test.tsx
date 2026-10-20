import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../auth";
import { ThemeProvider } from "../../theme";
import { LoginPage } from "../../pages/LoginPage";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
});

describe("LoginPage", () => {
  it("cycles through the dark, light and jade green themes", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>,
    );

    const toggle = await screen.findByRole("button", { name: "Toggle theme" });
    const root = document.documentElement.classList;
    await waitFor(() => expect(root.contains("dark")).toBe(true));
    expect(root.contains("jade")).toBe(false);
    expect(toggle.getAttribute("title")).toBe("Switch to Light");
    fireEvent.click(toggle);
    await waitFor(() => expect(root.contains("dark")).toBe(false));
    expect(root.contains("jade")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
    expect(toggle.getAttribute("title")).toBe("Switch to Jade green");
    fireEvent.click(toggle);
    await waitFor(() => expect(root.contains("jade")).toBe(true));
    expect(root.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("jade");
    expect(toggle.getAttribute("title")).toBe("Switch to Dark");
    fireEvent.click(toggle);
    await waitFor(() => expect(root.contains("dark")).toBe(true));
    expect(root.contains("jade")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("sets the SpecForge name as tall as the logo icon and shows the description subtitle", () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>,
    );
    const name = screen.getByTestId("wordmark");
    expect((name.previousElementSibling as HTMLElement).className).toContain("h-14");
    expect(name.className).toContain("leading-[56px]");
    expect(name.className).toContain("text-[56px]");
    expect(name.className).toContain("font-wordmark");
    expect(screen.getByText("Transform requirements into solution designs, diagrams, and living specs in minutes.")).toBeTruthy();
  });
});
