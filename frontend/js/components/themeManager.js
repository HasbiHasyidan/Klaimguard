const LOGO = "assets/logo.svg";
const ICON_LOGO = "assets/logo-icon.svg";
const THEME_STORAGE_KEY = "klaimguard-theme-v2";

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark-mode", isDark);
  const logo = document.getElementById("mainLogo");
  if (logo) logo.src = LOGO;
  const iconLogo = document.getElementById("mainLogoIcon");
  if (iconLogo) iconLogo.src = ICON_LOGO;
  const toggle = document.getElementById("themeToggleBtn");
  if (toggle) {
    toggle.innerHTML = `<span aria-hidden="true">${isDark ? "☼" : "☾"}</span>`;
    toggle.setAttribute("aria-label", isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap");
  }
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent("klaimguard:theme-change", { detail: { theme, isDark } }));
}

export function initTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(storedTheme || "light");
  document.getElementById("themeToggleBtn")?.addEventListener("click", () => {
    applyTheme(document.body.classList.contains("dark-mode") ? "light" : "dark");
  });
}
