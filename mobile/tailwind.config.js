/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Dark-only palette matching the web app's look.
      colors: {
        background: "#09090b",
        card: "#18181b",
        border: "#27272a",
        input: "#3f3f46",
        muted: "#a1a1aa",
        foreground: "#fafafa",
        primary: "#fafafa",
        accent: "#3b82f6",
        destructive: "#ef4444",
      },
    },
  },
  plugins: [],
}
