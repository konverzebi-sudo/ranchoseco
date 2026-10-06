import { createClient } from '@supabase/supabase-js'
import { getActorId } from './actor'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)

// Todas las tablas viven en el esquema "academia" (proyecto de Supabase compartido).
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  db: { schema: 'academia' },
  auth: { persistSession: true, storageKey: 'ranchoseco-auth' },
  // Cada cambio lleva quién lo hizo, para la "Actividad en el sitio" del Dashboard
  global: {
    fetch: (input, init) => {
      const id = getActorId()
      if (!id || !String(input instanceof Request ? input.url : input).includes('/rest/v1/')) return fetch(input, init)
      const headers = new Headers(init?.headers)
      headers.set('x-actor-id', id)
      return fetch(input, { ...init, headers })
    },
  },
})

export const BUCKETS = {
  photos: 'academia-photos',
  receipts: 'academia-receipts',
  reports: 'academia-reports',
} as const

/** Lanza el error de Supabase con un mensaje entendible. */
export function unwrap<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(friendlyError(res.error.message, res.error.code))
  return res.data
}

export function friendlyError(message: string, code?: string): string {
  if (code === '23505') return 'Ese registro ya existe.'
  if (code === '23503') return 'No se puede completar: hay información relacionada.'
  if (code === '42501' || /row-level security/i.test(message)) return 'No tienes permiso para realizar esta acción.'
  if (/schema must be one of|Invalid schema/i.test(message))
    return 'Falta exponer el esquema "academia" en Supabase (Project Settings > Data API).'
  if (/Failed to fetch|NetworkError/i.test(message)) return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.'
  return message
}

const signedCache = new Map<string, { url: string; exp: number }>()

/** URL temporal para un archivo privado (fotos, comprobantes, reportes). */
export async function signedUrl(bucket: string, path: string, seconds = 3600): Promise<string | null> {
  const k = `${bucket}/${path}`
  const hit = signedCache.get(k)
  if (hit && hit.exp > Date.now() + 60_000) return hit.url
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
  if (error || !data) return null
  signedCache.set(k, { url: data.signedUrl, exp: Date.now() + seconds * 1000 })
  return data.signedUrl
}
