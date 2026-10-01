import { supabase } from './supabase'

/** Deja un aviso en el Dashboard (p. ej. un cambio en la caja). Si falla, no detiene lo demás. */
export async function notify(title: string, body?: string, link = '/corte', kind = 'caja') {
  try {
    await supabase.from('notifications').insert({ kind, title, body: body ?? null, link })
  } catch { /* el aviso es opcional */ }
}
