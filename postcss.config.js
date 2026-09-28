import { fileURLToPath } from 'node:url'

// Rutas absolutas: funciona aunque el servidor se ejecute desde otra carpeta.
export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) },
    autoprefixer: {},
  },
}
