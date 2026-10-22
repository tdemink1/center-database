const root = document.documentElement;
const toggle = document.querySelector(".theme-toggle");
const thumb = toggle.querySelector(".thumb");

function applyTheme(theme) {
  root.dataset.theme = theme;
  const isDark = theme === "dark";
  toggle.setAttribute("aria-checked", String(isDark));
  thumb.textContent = isDark ? "🌙" : "☀️";
}

function saveTheme(theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch (e) {
    // Storage can be unavailable (private mode); the toggle still works for this visit.
  }
}

toggle.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  saveTheme(next);
});

// Follow system changes until the user picks a theme explicitly.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  let saved = null;
  try {
    saved = localStorage.getItem("theme");
  } catch (e) {}
  if (!saved) applyTheme(e.matches ? "dark" : "light");
});

applyTheme(root.dataset.theme);
