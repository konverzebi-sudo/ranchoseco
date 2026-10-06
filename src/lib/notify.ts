import { supabase } from './supabase'
import { getActor } from './actor'
export { getActor, setActor } from './actor'

/** Avisos que se quedan arriba en el Dashboard hasta marcarlos como vistos. */
export const ALERT_KINDS = ['caja', 'pago', 'recargo', 'mensualidades']

/**
 * Registra un movimiento en la bitácora del Dashboard (cobros, cambios, cortes…).
 * Los de tipo caja / pago / recargo además quedan como aviso hasta marcarlos como vistos.
 * Si falla, no detiene lo demás.
 */
export async function notify(title: string, body?: string, link = '/corte', kind = 'caja') {
  const row = { kind, title, body: body ?? null, link, actor: getActor() || null }
  try {
    const r = await supabase.from('notifications').insert(row)
    // Si la base de datos todavía no tiene la columna "actor", se guarda sin ella
    if (r.error && /actor/.test(r.error.message)) {
      const { actor, ...rest } = row
      await supabase.from('notifications').insert({ ...rest, body: [rest.body, actor ? `Registró: ${actor}` : null].filter(Boolean).join(' · ') || null })
    }
  } catch { /* la bitácora es opcional */ }
}
