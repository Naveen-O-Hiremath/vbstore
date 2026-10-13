// Apply the saved theme before the page paints. Dark is the default.
try {
  document.documentElement.dataset.theme = localStorage.getItem("vb_theme") === "light" ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}

// Tailwind theme: "Obsidian Kinetic" design tokens. Colour values live in
// css/site.css as CSS variables so the light and dark themes share one config.
const themed = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
tailwind.config = {
  theme: {
    extend: {
      colors: Object.fromEntries([
        "surface", "surface-container-lowest", "surface-container-low", "surface-container",
        "surface-container-high", "surface-container-highest", "on-surface", "on-surface-variant",
        "outline", "outline-variant", "primary", "primary-fixed", "on-primary", "primary-container",
        "on-primary-container", "secondary", "secondary-container", "tertiary", "on-tertiary",
        "tertiary-container", "error", "error-container", "chart"
      ].map((name) => [name, themed(name)])),
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist", "system-ui", "sans-serif"]
      },
      fontSize: {
        "headline-xl": ["48px", { lineHeight: "52px", letterSpacing: "-0.035em", fontWeight: "600" }],
        "headline-lg": ["32px", { lineHeight: "38px", letterSpacing: "-0.025em", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "30px", letterSpacing: "-0.02em", fontWeight: "500" }],
        "headline-sm": ["20px", { lineHeight: "26px", letterSpacing: "-0.015em", fontWeight: "500" }],
        "body-lg": ["18px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
        "body-md": ["15px", { lineHeight: "24px", letterSpacing: "-0.005em" }],
        "body-sm": ["13px", { lineHeight: "20px" }],
        "label-lg": ["14px", { lineHeight: "18px", letterSpacing: "0.01em", fontWeight: "600" }],
        "label-md": ["12px", { lineHeight: "16px", letterSpacing: "0.02em", fontWeight: "500" }],
        "label-sm": ["11px", { lineHeight: "14px", letterSpacing: "0.04em", fontWeight: "600" }]
      }
    }
  }
};
