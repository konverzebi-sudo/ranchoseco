import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Camera, ClipboardList, Loader2, X } from 'lucide-react'
import { Badge, Card, Modal, cx } from './ui'
import { useToast } from './toast'
import { useCategories } from '@/lib/api'
import { BUCKETS, signedUrl, supabase } from '@/lib/supabase'
import { date, toISODate } from '@/lib/format'
import type { Match } from '@/lib/types'

/** Reduce la foto antes de subirla (rápido desde el celular). */
async function shrink(file: File, max = 1400): Promise<Blob> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo procesar la foto'))), 'image/jpeg', 0.8))
}

function Thumb({ path, onRemove, onOpen }: { path: string; onRemove?: () => void; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let alive = true; signedUrl(BUCKETS.photos, path).then((u) => alive && setUrl(u)); return () => { alive = false } }, [path])
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-xl border border-ink-600 bg-ink-900">
      {url ? <button type="button" onClick={() => onOpen(url)} className="h-full w-full"><img src={url} alt="Evidencia del partido" className="h-full w-full object-cover" /></button>
        : <Loader2 className="m-auto mt-7 h-5 w-5 animate-spin text-muted" />}
      {onRemove && <button type="button" onClick={onRemove} className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-white" aria-label="Quitar foto"><X className="h-3.5 w-3.5" /></button>}
    </div>
  )
}

/** Fotos de evidencia del partido (se suben al momento; se guardan con el reporte). */
export function MatchPhotos({ matchId, photos, onChange }: { matchId: string; photos: string[]; onChange?: (p: string[]) => void }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const [big, setBig] = useState<string | null>(null)
  const add = async (files: FileList | null) => {
    if (!files?.length || !onChange) return
    const added: string[] = []
    setBusy(files.length)
    for (const f of [...files].slice(0, 10)) {
      try {
        const blob = await shrink(f)
        const path = `partidos/${matchId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
        const { error } = await supabase.storage.from(BUCKETS.photos).upload(path, blob, { contentType: 'image/jpeg' })
        if (error) throw new Error(error.message)
        added.push(path)
      } catch (e) { toast.error(`No se pudo subir una foto: ${e instanceof Error ? e.message : e}`) }
      setBusy((b) => b - 1)
    }
    if (added.length) onChange([...photos, ...added])
    if (input.current) input.current.value = ''
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => <Thumb key={p} path={p} onOpen={setBig} onRemove={onChange ? () => onChange(photos.filter((x) => x !== p)) : undefined} />)}
        {onChange && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy > 0}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink-500 text-xs text-muted hover:border-brand hover:text-brand">
            {busy > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}{busy > 0 ? 'Subiendo…' : 'Agregar'}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      {big && <Modal open onClose={() => setBig(null)} title="Evidencia del partido" wide><img src={big} alt="Evidencia del partido" className="mx-auto max-h-[70vh] rounded-xl" /></Modal>}
    </div>
  )
}

/** Dashboard de administración: reportes de los partidos que ya terminaron. */
export function MatchReportsCard() {
  const cats = useCategories()
  const from = toISODate(new Date(Date.now() - 21 * 86400_000))
  const q = useQuery({
    queryKey: ['matches', 'reports', from],
    queryFn: async () => {
      const r = await supabase.from('matches').select('*').not('report_at', 'is', null).gte('date', from).order('report_at', { ascending: false }).limit(12)
      return r.error ? [] : (r.data as Match[])
    },
  })
  const list = q.data ?? []
  if (!list.length) return null
  const cat = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? ''
  const LABEL: Record<string, string> = { injuries: 'Lesionados', kids: 'Niños', parents: 'Papás', referees: 'Árbitros', tournament: 'Torneo', other: 'Notas' }
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4">
        <ClipboardList className="h-5 w-5 text-brand" />
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Reportes de partidos</h2>
      </div>
      <ul className="divide-y divide-ink-700">
        {list.map((m) => {
          const r = (m.report ?? {}) as Record<string, unknown>
          const lines = Object.entries(r).filter(([k, v]) => k !== 'photos' && typeof v === 'string' && v).map(([k, v]) => `${LABEL[k] ?? k}: ${v}`)
          const photos = Array.isArray(r.photos) ? (r.photos as string[]) : []
          const won = m.goals_for != null && m.goals_against != null ? (m.goals_for > m.goals_against ? 'ok' : m.goals_for < m.goals_against ? 'bad' : 'warn') : 'neutral'
          return (
            <li key={m.id} className="px-5 py-3">
              <Link to={`/partidos/${m.id}`} className="flex flex-wrap items-center gap-2 hover:text-brand">
                <span className="font-semibold">{cat(m.category_id)} vs {m.opponent}</span>
                {m.goals_for != null && <Badge tone={won as 'ok' | 'bad' | 'warn'}>{m.goals_for}-{m.goals_against}</Badge>}
                {r.injuries ? <Badge tone="bad">Lesionados</Badge> : null}
                <span className="text-xs text-muted">· {date(m.date, 'd MMM')}</span>
              </Link>
              {lines.length > 0 && <p className={cx('mt-1 text-sm text-muted')}>{lines.join(' · ')}</p>}
              {photos.length > 0 && <div className="mt-2"><MatchPhotos matchId={m.id} photos={photos} /></div>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
