/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 所有颜色通过 CSS 变量驱动，由 <html data-theme="dark|light"> 切换
        base: {
          bg: "var(--bg)",
          card: "var(--card)",
          cardhover: "var(--cardhover)",
          border: "var(--border)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
        },
        ok: "var(--ok)",
        danger: "var(--danger)",
        warn: "var(--warn)",
      },
      fontFamily: {
        sans: ["Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("daisyui")],
}
