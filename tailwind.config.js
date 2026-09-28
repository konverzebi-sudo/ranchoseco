import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url)).split('\\').join('/')

/** @type {import('tailwindcss').Config} */
export default {
  content: [here('./index.html'), here('./src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#F2E30A', hover: '#FFF23D', dim: 'rgba(242,227,10,0.12)' },
        ink: { DEFAULT: '#111111', 900: '#0B0B0B', 800: '#161616', 700: '#202020', 600: '#2A2A2A', 500: '#3A3A3A' },
        muted: '#A3A3A3',
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
