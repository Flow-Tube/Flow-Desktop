// Paints the active profile's last theme before the app loads, so the first frame after a
// profile switch (a restart) is already in that profile's colours. ThemeController
// (src/lib/useTheme.ts) writes the snapshot; the key follows src/lib/storage/profileStorage.ts.
(function () {
  try {
    var profile = window.__FLOW_PROFILE__;
    var prefix = profile && profile.id && !profile.isDefault ? "p:" + profile.id + ":" : "";
    var raw = window.localStorage.getItem(prefix + "flow_boot_theme");
    if (!raw) return;
    var theme = JSON.parse(raw);
    var root = document.documentElement;
    var variables = theme.variables || {};
    Object.keys(variables).forEach(function (name) {
      root.style.setProperty(name, variables[name]);
    });
    if (theme.themeId) root.dataset.theme = theme.themeId;
    if (theme.variant) {
      root.dataset.themeVariant = theme.variant;
      root.style.colorScheme = theme.variant === "light" ? "light" : "dark";
    }
  } catch (error) {
    // Without a snapshot the stylesheet's own defaults apply, as before.
  }
})();
