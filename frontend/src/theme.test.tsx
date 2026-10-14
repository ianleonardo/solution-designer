import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTheme, ThemeProvider, THEMES, useTheme } from "./theme";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  document.documentElement.className = "";
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

function Probe() {
  const { theme } = useTheme();
  return <p>theme:{theme}</p>;
}

describe("theme", () => {
  it("has dark, light and jade, cycling in that order", () => {
    expect(THEMES).toEqual(["dark", "light", "jade"]);
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("jade");
    expect(nextTheme("jade")).toBe("dark");
  });

  it("restores a saved jade theme and applies only the jade class", async () => {
    store.set("theme", "jade");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText("theme:jade")).toBeTruthy();
    await waitFor(() => expect(document.documentElement.classList.contains("jade")).toBe(true));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("falls back to dark for an unknown saved value", async () => {
    store.set("theme", "neon");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText("theme:dark")).toBeTruthy();
    await waitFor(() => expect(store.get("theme")).toBe("dark"));
  });
});
