import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: {
          bg: "#0D0F12",
          surface: "#16191D",
          surface2: "#1D2126",
          border: "#262B31",
        },
        ink: {
          primary: "#F5F3EE",
          muted: "#8B9198",
          faint: "#565C63",
        },
        accent: {
          DEFAULT: "#2DD8C9",
          dim: "#1FA79B",
          bright: "#5FF0E3",
        },
        signal: {
          up: "#6BCF8E",
          down: "#E4788A",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      backgroundImage: {
        holo: "linear-gradient(115deg, #2DD8C9 0%, #E85FD1 45%, #F4C15C 100%)",
        "holo-soft":
          "linear-gradient(115deg, rgba(45,216,201,0.35) 0%, rgba(232,95,209,0.35) 45%, rgba(244,193,92,0.35) 100%)",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -8px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(45,216,201,0.4), 0 0 32px -4px rgba(45,216,201,0.35)",
      },
      borderRadius: {
        card: "14px",
      },
    },
  },
  plugins: [],
};

export default config;
