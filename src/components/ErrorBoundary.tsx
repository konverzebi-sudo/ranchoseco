import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

const RELOAD_KEY = 'rs-reloaded-at'

/** ¿El error es porque se publicó una versión nueva y ya no existe el archivo de esa sección? */
export const isChunkError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically|ChunkLoadError|preload/i.test(String((e as Error)?.message ?? e))

/** Recarga la página una sola vez (si ya se recargó hace menos de 30 s, no lo repite para no ciclarse). */
export function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch { /* sin almacenamiento: recarga de todos modos */ }
  window.location.reload()
  return true
}

/**
 * Evita la pantalla en blanco: si una sección no carga porque hay versión nueva,
 * recarga sola; si es otro error, muestra un aviso con botón para actualizar.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) { return { error } }
  componentDidCatch(error: unknown) {
    if (isChunkError(error)) reloadOnce()
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    // Al cambiar de sección se vuelve a intentar
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    const chunk = isChunkError(this.state.error)
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-ink-600 bg-ink-800 p-6 text-center">
        <p className="font-display text-2xl font-bold uppercase">{chunk ? 'Hay una versión nueva' : 'Algo salió mal'}</p>
        <p className="mt-2 text-sm text-muted">{chunk ? 'Actualiza la página para cargar los cambios más recientes.' : 'No se pudo mostrar esta sección. Actualiza la página; si sigue pasando, avísanos.'}</p>
        <button onClick={() => window.location.reload()}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-ink hover:brightness-110">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </div>
    )
  }
}
