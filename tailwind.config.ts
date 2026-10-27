import type { Config } from "tailwindcss";

// هوية "حبر الطباعة": ألوان CMYK الصناعية على ورق بارد
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', "Tahoma", "Segoe UI", "sans-serif"] },
      colors: {
        ink: { DEFAULT: "#14213D", soft: "#3A4A6B", faint: "#8A96AD" },
        paper: { DEFAULT: "#F3F5F7", card: "#FFFFFF", line: "#DDE3EA" },
        cyan: { process: "#0093C9", deep: "#006E98" },
        magenta: { process: "#D6246E" },
        yellow: { process: "#F2B71F" },
        board: { bg: "#0B131D", panel: "#121D2B", line: "#22324A" },
      },
    },
  },
  plugins: [],
};
export default config;
