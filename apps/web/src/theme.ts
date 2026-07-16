/**
 * `applyInitialTheme` — read the saved theme from localStorage and apply
 * it to the <html> element. If no saved theme, the `data-theme="dark"`
 * default from index.html is used.
 */
export function applyInitialTheme(): void {
  if (typeof window === "undefined") return;
  const saved = window.localStorage.getItem("eggTheme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}

/**
 * `mountThemeToggle` — wire the `.ep-theme-toggle` button (eggproject-design
 * token) to flip `data-theme` between `light` and `dark`. Persists to
 * localStorage. Called once from main.tsx after the React app mounts.
 */
export function mountThemeToggle(): void {
  if (typeof document === "undefined") return;
  // The .ep-theme-toggle button is defined in the eggproject-design CSS as a
  // 34px icon button that shows the theme you'll switch TO. We wire it here.
  const buttons = document.querySelectorAll<HTMLElement>(".ep-theme-toggle");
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next: "light" | "dark" = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      window.localStorage.setItem("eggTheme", next);
    });
  }
}
