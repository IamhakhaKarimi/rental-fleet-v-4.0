import type { Config } from "tailwindcss";

/**
 * Colours map to CSS variables (defined in app/globals.css) so the whole app
 * themes off `:root` — matching the Streamlit app's `ui/theme.py` model, where a
 * super-admin can recolour every token and night mode merges a dark palette.
 * Defaults equal the original tokens, so v4.0 looks identical until customised.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        ink: "var(--text)",
        muted: "var(--muted)",
        line: "var(--border)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        ok: "var(--ok)",
        info: "var(--info)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        archived: "var(--archived)",
        // True-alert orange for return/renewal urgency — see --cal-warn.
        "cal-warn": "var(--cal-warn)",
        "cal-warn-ink": "var(--cal-warn-ink)",
        // Licence panel semantics — see the --lic-* block in globals.css.
        "lic-ok": "var(--lic-ok)",
        "lic-ok-ink": "var(--lic-ok-ink)",
        "lic-ok-bg": "var(--lic-ok-bg)",
        "lic-off": "var(--lic-off)",
        "lic-off-ink": "var(--lic-off-ink)",
        "lic-off-bg": "var(--lic-off-bg)",
        "lic-info-bg": "var(--lic-info-bg)",
        "lic-info-ink": "var(--lic-info-ink)",
      },
      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
        pill: "999px",
      },
      boxShadow: {
        // Neomorphism (light): paired soft highlight + shadow. Used by the timeline.
        neo: "6px 6px 14px var(--neo-dark), -6px -6px 14px var(--neo-light)",
        "neo-sm": "3px 3px 7px var(--neo-dark), -3px -3px 7px var(--neo-light)",
        "neo-inset": "inset 3px 3px 7px var(--neo-dark), inset -3px -3px 7px var(--neo-light)",
        soft: "0 1px 2px rgba(17,24,39,0.05), 0 1px 3px rgba(17,24,39,0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
