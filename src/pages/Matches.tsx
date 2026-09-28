import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trophy, ChevronRight, MapPin } from 'lucide-react'
import { Badge, Button, Card, Empty, ErrorState, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCategories, useMatches } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { date, time, today } from '@/lib/format'
import type { Match, MatchStatus } from '@/lib/types'

export function resultBadge(m: Match) {
  if (m.status === 'cancelado') return <Badge>Cancelado</Badge>
  if (m.goals_for == null || m.goals_against == null) return <Badge tone="info">{m.date >= today() ? 'Próximo' : 'Sin resultado'}</Badge>
  const tone = m.goals_for > m.goals_against ? 'ok' : m.goals_for < m.goals_against ? 'bad' : 'warn'
  const label = tone === 'ok' ? 'Victoria' : tone === 'bad' ? 'Derrota' : 'Empate'
  return <Badge tone={tone}>{label} {m.goals_for}-{m.goals_against}</Badge>
}

export default function Matches() {
  const categories = useCategories()
  const [cat, setCat] = useState('')
  const [when, setWhen] = useState<'proximos' | 'jugados'>('proximos')
  const matches = useMatches({ categoryId: cat || undefined })
  const [creating, setCreating] = useState(false)
  const nav = useNavigate()
  const t = today()
  const list = (matches.data ?? []).filter((m) => (when === 'proximos' ? m.date >= t && m.status === 'programado' : m.date < t || m.status !== 'programado'))
  if (when === 'proximos') list.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))
  const catName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? ''

  return (
    <>
      <PageHeader title="Partidos" subtitle="Convocatoria, alineación, resultado y estadísticas por jugador."
        actions={<Button icon={Plus} onClick={() => setCreating(true)}>Nuevo partido</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={when} onChange={setWhen} options={[{ id: 'proximos', label: 'Próximos' }, { id: 'jugados', label: 'Jugados' }]} />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto min-w-[200px]" aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      {matches.error ? <ErrorState error={matches.error} /> : matches.isLoading ? <Spinner /> : !list.length ? (
        <Card><Empty icon={Trophy} title={when === 'proximos' ? 'No hay partidos programados' : 'Aún no hay partidos jugados'}
          action={<Button icon={Plus} onClick={() => setCreating(true)}>Programar partido</Button>} /></Card>
      ) : (
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id}>
              <Link to={`/partidos/${m.id}`}>
                <Card className="flex items-center gap-3 p-4 transition hover:border-ink-500">
                  <div className="w-16 shrink-0 rounded-xl bg-ink-900 py-2 text-center">
                    <p className="text-xs uppercase text-muted">{date(m.date, 'MMM')}</p>
                    <p className="font-display text-2xl font-bold leading-none">{date(m.date, 'd')}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-xl font-bold uppercase">Rancho Seco vs {m.opponent}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                      <span>{catName(m.category_id)}</span>
                      <span>{time(m.time)}</span>
                      {m.venue && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{m.venue}</span>}
                      <span>{m.is_home ? 'Local' : 'Visitante'}</span>
                    </p>
                  </div>
                  {resultBadge(m)}
                  <ChevronRight className="h-5 w-5 text-muted" />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <MatchModal defaultCategory={cat} onClose={() => setCreating(false)} onSaved={(id) => nav(`/partidos/${id}`)} />}
    </>
  )
}

export function MatchModal({ match, defaultCategory, defaultDate, onClose, onSaved }: { match?: Match; defaultCategory?: string; defaultDate?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { data: categories } = useCategories()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({
    category_id: match?.category_id ?? defaultCategory ?? '', opponent: match?.opponent ?? '', date: match?.date ?? defaultDate ?? today(),
    time: match?.time?.slice(0, 5) ?? '', venue: match?.venue ?? '', is_home: match?.is_home ?? true,
    goals_for: match?.goals_for != null ? String(match.goals_for) : '', goals_against: match?.goals_against != null ? String(match.goals_against) : '',
    status: (match?.status ?? 'programado') as MatchStatus, notes: match?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.category_id) return toast.error('Elige la categoría.')
    if (!f.opponent.trim()) return toast.error('Escribe el nombre del rival.')
    const hasScore = f.goals_for !== '' && f.goals_against !== ''
    setSaving(true)
    try {
      const payload = {
        category_id: f.category_id, opponent: f.opponent.trim(), date: f.date, time: f.time || null, venue: f.venue.trim() || null,
        is_home: f.is_home, notes: f.notes.trim() || null,
        goals_for: hasScore ? Number(f.goals_for) : null, goals_against: hasScore ? Number(f.goals_against) : null,
        status: hasScore && f.status === 'programado' ? 'jugado' : f.status,
      }
      let id = match?.id
      if (id) unwrap(await supabase.from('matches').update(payload).eq('id', id))
      else id = (unwrap(await supabase.from('matches').insert(payload).select('id').single()) as { id: string }).id
      await qc.invalidateQueries({ queryKey: ['matches'] })
      toast.ok('Partido guardado')
      onSaved?.(id!)
      onClose()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={match ? 'Editar partido' : 'Nuevo partido'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="match-form" loading={saving}>Guardar</Button></>}>
      <form id="match-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría *">
            <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">Elige…</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Rival *"><Input value={f.opponent} onChange={(e) => setF({ ...f, opponent: e.target.value })} autoFocus={!match} /></Field>
          <Field label="Fecha"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Hora"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
          <Field label="Sede"><Input value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="Cancha / dirección" /></Field>
          <Field label="Condición">
            <Segmented value={f.is_home ? 'l' : 'v'} onChange={(v) => setF({ ...f, is_home: v === 'l' })} options={[{ id: 'l', label: 'Local' }, { id: 'v', label: 'Visitante' }]} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Goles R. Seco"><Input type="number" min="0" inputMode="numeric" value={f.goals_for} onChange={(e) => setF({ ...f, goals_for: e.target.value })} /></Field>
          <Field label="Goles rival"><Input type="number" min="0" inputMode="numeric" value={f.goals_against} onChange={(e) => setF({ ...f, goals_against: e.target.value })} /></Field>
          <Field label="Estado">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as MatchStatus })}>
              <option value="programado">Programado</option><option value="jugado">Jugado</option><option value="cancelado">Cancelado</option>
            </Select>
          </Field>
        </div>
        <Field label="Observaciones del profesor"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  )
}
