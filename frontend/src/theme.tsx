import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "dark" | "light" | "jade";

/** The order the toggle button cycles through. */
export const THEMES: Theme[] = ["dark", "light", "jade"];

export const THEME_LABELS: Record<Theme, string> = { dark: "Dark", light: "Light", jade: "Jade green" };

type ThemeValue = { theme: Theme; next: Theme; toggle: () => void };

const ThemeContext = createContext<ThemeValue | null>(null);

function stored(): Theme {
  const value = localStorage.getItem("theme");
  return THEMES.includes(value as Theme) ? (value as Theme) : "dark";
}

export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

/** Icon that shows what the toggle switches to. */
export function themeIcon(theme: Theme): string {
  return { dark: "dark_mode", light: "light_mode", jade: "spa" }[theme];
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("jade", theme === "jade");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      next: nextTheme(theme),
      toggle() {
        setTheme((current) => nextTheme(current));
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is missing");
  return value;
}
