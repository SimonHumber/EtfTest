import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      boxShadow: { panel: "0 1px 2px rgba(15, 23, 42, .06), 0 10px 30px rgba(15, 23, 42, .04)" },
    },
  },
  plugins: [],
};

export default config;
