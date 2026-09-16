/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Rajdhani', 'system-ui', 'sans-serif'],
      },
      colors: {
        // The app was designed Aurora-first, where "violet" IS the accent.
        // Remapping the whole violet ramp onto the live theme accent makes
        // every violet-* utility (borders, text, bg, /opacity modifiers)
        // follow the active theme automatically.
        violet: {
          300: 'rgb(from color-mix(in srgb, var(--accent) 65%, white) r g b / <alpha-value>)',
          400: 'rgb(from var(--accent) r g b / <alpha-value>)',
          500: 'rgb(from var(--accent) r g b / <alpha-value>)',
          600: 'rgb(from color-mix(in srgb, var(--accent) 85%, black) r g b / <alpha-value>)',
          700: 'rgb(from color-mix(in srgb, var(--accent) 68%, black) r g b / <alpha-value>)',
          800: 'rgb(from color-mix(in srgb, var(--accent) 52%, black) r g b / <alpha-value>)',
          900: 'rgb(from color-mix(in srgb, var(--accent) 38%, black) r g b / <alpha-value>)',
          950: 'rgb(from color-mix(in srgb, var(--accent) 28%, black) r g b / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
