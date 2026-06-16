import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: ["text-[8px]", "text-[9px]", "text-[10px]", "text-[11px]"],
  theme: {
    extend: {
      colors: {
        zendesk: {
          navy: "#03363d",
          teal: "#17494d",
          green: "#30aabc",
          sidebar: "#f8f9f9",
          border: "#d8dcde",
          muted: "#68737d",
        },
      },
    },
  },
  plugins: [],
};

export default config;
