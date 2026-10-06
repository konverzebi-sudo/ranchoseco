import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trophy, ChevronRight, MapPin, Copy } from 'lucide-react'
import { Badge, Button, Card, Empty, ErrorState, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Textarea, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useCategories, useMatches, useStudents } from '@/lib/api'
import { useRole } from '@/lib/role'
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

/** Mensaje de convocatoria para copiar y mandar a los papás. */
export function invitationMessage(m: { category: string; opponent: string; date: string; time: string; venue: string; is_home: boolean; notes: string }, players: string[]) {
  const cita = m.time ? (() => { const [h, mi] = m.time.split(':').map(Number); const d = new Date(2000, 0, 1, h, mi - 30); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` })() : ''
  const lines = [
    `⚽ ¡CONVOCATORIA RANCHO SECO! ⚽`,
    `Categoría ${m.category}`,
    '',
    `📅 ${date(m.date, "EEEE d 'de' MMMM")}`,
    m.time ? `🕐 Partido: ${time(m.time)}` : '',
    cita ? `⏰ Cita: ${time(cita)} (30 minutos antes para calentar)` : '⏰ Cita: 30 minutos antes del partido para calentar',
    `🆚 Rival: ${m.opponent} (${m.is_home ? 'local' : 'visitante'})`,
    m.venue ? `📍 ${m.venue}` : '',
    m.notes.trim() ? `\n📝 ${m.notes.trim()}` : '',
    players.length ? `\nConvocados:\n${players.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : '',
    '',
    'Recuerden:',
    '✅ Uniforme completo',
    '✅ Termo de hidratación',
    '✅ Llegar 30 minutos antes para calentar',
    '💛 Actitud de divertirnos y crecer en la cancha.',
    '',
    '¡Vamos Rancho Seco! 🐎',
  ]
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function MatchModal({ match, defaultCategory, defaultDate, onClose, onSaved }: { match?: Match; defaultCategory?: string; defaultDate?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const role = useRole()
  const { data: allCategories } = useCategories()
  const students = useStudents()
  const qc = useQueryClient()
  const toast = useToast()
  // El profe sólo programa partidos de sus categorías
  const categories = (allCategories ?? []).filter((c) => !role.isProfe || role.categoryIds.includes(c.id))
  const [f, setF] = useState({
    category_id: match?.category_id ?? (defaultCategory && categories.some((c) => c.id === defaultCategory) ? defaultCategory : categories.length === 1 ? categories[0].id : ''),
    opponent: match?.opponent ?? '', date: match?.date ?? defaultDate ?? today(),
    time: match?.time?.slice(0, 5) ?? '', venue: match?.venue ?? '', is_home: match?.is_home ?? true,
    goals_for: match?.goals_for != null ? String(match.goals_for) : '', goals_against: match?.goals_against != null ? String(match.goals_against) : '',
    status: (match?.status ?? 'programado') as MatchStatus, notes: match?.notes ?? '',
  })
  const [called, setCalled] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [invite, setInvite] = useState<{ id: string; text: string } | null>(null)
  const roster = (students.data ?? []).filter((s) => s.status === 'activo' && s.category_id === f.category_id).sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  const played = f.status === 'jugado'
  const toggle = (id: string) => setCalled((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.category_id) return toast.error('Elige la categoría.')
    if (!f.opponent.trim()) return toast.error('Escribe el nombre del rival.')
    // Sólo un partido jugado lleva marcador
    const hasScore = played && f.goals_for !== '' && f.goals_against !== ''
    setSaving(true)
    try {
      const payload = {
        category_id: f.category_id, opponent: f.opponent.trim(), date: f.date, time: f.time || null, venue: f.venue.trim() || null,
        is_home: f.is_home, notes: f.notes.trim() || null,
        goals_for: hasScore ? Number(f.goals_for) : null, goals_against: hasScore ? Number(f.goals_against) : null,
        status: f.status,
      }
      let id = match?.id
      if (id) unwrap(await supabase.from('matches').update(payload).eq('id', id))
      else {
        id = (unwrap(await supabase.from('matches').insert(payload).select('id').single()) as { id: string }).id
        if (called.size) unwrap(await supabase.from('match_players').insert([...called].map((student_id) => ({ match_id: id, student_id }))))
      }
      await Promise.all(['matches', 'match_players'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.ok('Partido guardado')
      if (match) { onSaved?.(id!); onClose(); return }
      const names = roster.filter((s) => called.has(s.id)).map((s) => s.full_name)
      setInvite({ id: id!, text: invitationMessage({ ...f, category: categories.find((c) => c.id === f.category_id)?.name ?? '' }, names) })
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  if (invite) {
    const copy = async () => { try { await navigator.clipboard.writeText(invite.text); toast.ok('Mensaje copiado. Pégalo en el grupo de WhatsApp.') } catch { toast.error('No se pudo copiar; selecciónalo y cópialo.') } }
    const done = () => { onSaved?.(invite.id); onClose() }
    return (
      <Modal open onClose={done} title="¡Partido creado! Mensaje de convocatoria"
        footer={<><Button variant="secondary" onClick={done}>Ir al partido</Button><Button variant="whatsapp" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(invite.text)}`, '_blank', 'noopener')}>Enviar por WhatsApp</Button><Button icon={Copy} onClick={copy}>Copiar mensaje</Button></>}>
        <p className="mb-2 text-sm text-muted">Cópialo y pégalo en el grupo de papás (puedes editarlo antes).</p>
        <Textarea rows={16} value={invite.text} onChange={(e) => setInvite({ ...invite, text: e.target.value })} />
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={match ? 'Editar partido' : 'Nuevo partido'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="match-form" loading={saving}>{match ? 'Guardar' : 'Crear partido'}</Button></>}>
      <form id="match-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría *">
            <Select value={f.category_id} onChange={(e) => { setF({ ...f, category_id: e.target.value }); setCalled(new Set()) }} disabled={!!match}>
              <option value="">Elige…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Rival *"><Input value={f.opponent} onChange={(e) => setF({ ...f, opponent: e.target.value })} /></Field>
          <Field label="Fecha"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Hora del partido"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
          <Field label="Sede y dirección"><Input value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="Cancha, calle y colonia" /></Field>
          <Field label="Condición">
            <Segmented value={f.is_home ? 'l' : 'v'} onChange={(v) => setF({ ...f, is_home: v === 'l' })} options={[{ id: 'l', label: 'Local' }, { id: 'v', label: 'Visitante' }]} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Estado">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as MatchStatus })}>
              <option value="programado">Programado</option><option value="jugado">Jugado</option><option value="cancelado">Cancelado</option>
            </Select>
          </Field>
          {played && <>
            <Field label="Goles R. Seco"><Input type="number" min="0" inputMode="numeric" value={f.goals_for} onChange={(e) => setF({ ...f, goals_for: e.target.value })} /></Field>
            <Field label="Goles rival"><Input type="number" min="0" inputMode="numeric" value={f.goals_against} onChange={(e) => setF({ ...f, goals_against: e.target.value })} /></Field>
          </>}
        </div>
        <Field label="Observaciones del profesor"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ej. traer short negro, el partido es en la cancha 2…" /></Field>
        {!match && f.category_id && (
          <Field label={`Convocados (${called.size} de ${roster.length})`}>
            <div className="mb-2 flex gap-3 text-xs">
              <button type="button" className="text-brand hover:underline" onClick={() => setCalled(new Set(roster.map((s) => s.id)))}>Convocar a todos</button>
              <button type="button" className="text-muted hover:underline" onClick={() => setCalled(new Set())}>Quitar todos</button>
            </div>
            <ul className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {roster.map((s) => (
                <li key={s.id}>
                  <label className={cx('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm', called.has(s.id) ? 'border-brand bg-brand-dim' : 'border-ink-600')}>
                    <input type="checkbox" checked={called.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 accent-[#F2E30A]" />
                    <span className="truncate">{s.full_name}</span>
                  </label>
                </li>
              ))}
              {!roster.length && <li className="text-sm text-muted">No hay alumnos activos en esta categoría.</li>}
            </ul>
          </Field>
        )}
      </form>
    </Modal>
  )
}
