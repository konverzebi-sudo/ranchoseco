import { fileURLToPath } from 'node:url'

const v = (name) => `rgb(var(${name}) / <alpha-value>)`
const here = (p) => fileURLToPath(new URL(p, import.meta.url)).split('\\').join('/')

/** @type {import('tailwindcss').Config} */
export default {
  content: [here('./index.html'), here('./src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#F2E30A', hover: '#FFF23D', dim: 'rgba(242,227,10,0.12)' },
        // Los tonos cambian según la zona: oscuros en la barra lateral, claros en el contenido (ver index.css)
        ink: { DEFAULT: '#111111', 900: v('--ink-900'), 800: v('--ink-800'), 700: v('--ink-700'), 600: v('--ink-600'), 500: v('--ink-500') },
        page: v('--page'),
        white: v('--fg'),
        muted: v('--muted'),
        ok: '#22C55E',
        warn: '#F59E0B',
        bad: '#EF4444',
        info: '#60A5FA',
        wa: '#25D366',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
