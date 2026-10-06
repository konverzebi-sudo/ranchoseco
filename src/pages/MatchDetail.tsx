import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Save, Trash2, Users, MapPin, Minus, Plus, ClipboardList, HeartPulse } from 'lucide-react'
import { Avatar, Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, Spinner, Textarea, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { MatchModal, resultBadge } from './Matches'
import { useCategories, useMatchPlayers, useMatches, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { date, time } from '@/lib/format'
import type { Match, MatchPlayer, MatchReport } from '@/lib/types'
import { MatchPhotos } from '@/components/MatchPhotos'

const POSITIONS = ['Portero', 'Defensa', 'Medio', 'Delantero', 'Ala', 'Pívot', 'Cierre']
type Row = Omit<MatchPlayer, 'match_id' | 'notes' | 'injured'> & { called: boolean; notes: string; injured: boolean }

function Counter({ value, onChange, max = 99, label }: { value: number; onChange: (v: number) => void; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-1" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="rounded-lg bg-ink-700 p-1.5 text-muted hover:text-white" aria-label={`Menos ${label}`}><Minus className="h-3.5 w-3.5" /></button>
      <span className="w-6 text-center font-semibold">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} className="rounded-lg bg-ink-700 p-1.5 text-muted hover:text-white" aria-label={`Más ${label}`}><Plus className="h-3.5 w-3.5" /></button>
    </div>
  )
}

export default function MatchDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const matches = useMatches()
  const students = useStudents()
  const { data: categories } = useCategories()
  const players = useMatchPlayers({ matchId: id })
  const qc = useQueryClient()
  const toast = useToast()
  const match = matches.data?.find((m) => m.id === id)
  const [editing, setEditing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const roster = useMemo(() => (students.data ?? []).filter((s) => s.category_id === match?.category_id && s.status === 'activo'), [students.data, match?.category_id])

  useEffect(() => {
    if (!players.data || !match) return
    const saved = new Map(players.data.map((p) => [p.student_id, p]))
    setRows(Object.fromEntries(roster.map((s) => {
      const p = saved.get(s.id)
      return [s.id, { student_id: s.id, called: !!p, attended: p?.attended ?? true, starter: p?.starter ?? false, position: p?.position ?? '', goals: p?.goals ?? 0, assists: p?.assists ?? 0, minutes: p?.minutes ?? 0, notes: p?.notes ?? '', injured: !!p?.injured }]
    })))
    setDirty(false)
  }, [players.data, roster, match])

  const upd = (sid: string, patch: Partial<Row>) => { setRows((r) => ({ ...r, [sid]: { ...r[sid], ...patch } })); setDirty(true) }

  const save = async () => {
    setSaving(true)
    try {
      const called = Object.values(rows).filter((r) => r.called)
      const removed = (players.data ?? []).filter((p) => !rows[p.student_id]?.called).map((p) => p.student_id)
      if (removed.length) unwrap(await supabase.from('match_players').delete().eq('match_id', id!).in('student_id', removed))
      if (called.length) unwrap(await supabase.from('match_players').upsert(called.map(({ called: _c, ...r }) => ({ ...r, position: r.position || null, notes: r.notes.trim() || null, match_id: id })), { onConflict: 'match_id,student_id' }))
      await qc.invalidateQueries({ queryKey: ['match_players'] })
      toast.ok(`Lista guardada: ${called.filter((r) => r.attended).length} asistieron · ${called.filter((r) => !r.attended).length} faltaron`)
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }

  const remove = async () => {
    try {
      unwrap(await supabase.from('matches').delete().eq('id', id!))
      await qc.invalidateQueries({ queryKey: ['matches'] })
      toast.ok('Partido eliminado')
      nav('/partidos')
    } catch (e) { toast.error(e) }
  }

  if (matches.error) return <ErrorState error={matches.error} />
  if (matches.isLoading || students.isLoading) return <Spinner />
  if (!match) return <Empty icon={Users} title="Partido no encontrado" action={<Link to="/partidos"><Button>Ver partidos</Button></Link>} />
  const calledCount = Object.values(rows).filter((r) => r.called).length
  const starters = Object.values(rows).filter((r) => r.called && r.attended && r.starter).length
  const absentCount = Object.values(rows).filter((r) => r.called && !r.attended).length

  return (
    <>
      <Link to="/partidos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-white"><ArrowLeft className="h-4 w-4" /> Partidos</Link>
      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">{categories?.find((c) => c.id === match.category_id)?.name} · {date(match.date, "EEEE d 'de' MMMM")} {time(match.time)}</p>
            <h1 className="mt-1 font-display text-3xl font-bold uppercase leading-tight">Rancho Seco <span className="text-brand">vs</span> {match.opponent}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              {match.venue && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{match.venue}</span>}
              <span>{match.is_home ? 'Local' : 'Visitante'}</span>
              {resultBadge(match)}
            </p>
            {match.notes && <p className="mt-3 rounded-xl bg-ink-900 p-3 text-sm text-muted">{match.notes}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Resultado y datos</Button>
            <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDel(true)} aria-label="Eliminar partido" />
          </div>
        </div>
      </Card>

      <div className="sticky top-[57px] z-20 -mx-4 mb-3 flex items-center justify-between gap-3 border-b border-ink-600 bg-page/95 px-4 py-3 backdrop-blur lg:top-0 lg:mx-0 lg:rounded-2xl lg:border">
        <p className="text-sm"><span className="font-display text-2xl font-bold text-brand">{calledCount}</span><span className="text-muted"> convocados · {absentCount} faltaron · {starters} titulares</span></p>
        <Button icon={Save} loading={saving} disabled={!dirty} onClick={save}>Guardar</Button>
      </div>

      {players.isLoading ? <Spinner /> : roster.length === 0 ? (
        <Card><Empty icon={Users} title="No hay alumnos activos en esta categoría" /></Card>
      ) : (
        <ul className="space-y-2">
          {roster.map((s) => {
            const r = rows[s.id]
            if (!r) return null
            return (
              <li key={s.id}>
                <Card className={cx('p-3', r.called && 'border-brand/40')}>
                  <div className="flex items-center gap-3">
                    <Avatar name={s.full_name} path={s.photo_path} size={38} />
                    <p className="min-w-0 flex-1 truncate font-medium">{s.full_name}</p>
                    <div className="flex overflow-hidden rounded-xl border border-ink-600 text-xs font-semibold sm:text-sm" role="group" aria-label={`Asistencia de ${s.full_name}`}>
                      {([
                        ['asistio', 'Asistió', r.called && r.attended, 'bg-ok text-ink'],
                        ['falta', 'Faltó', r.called && !r.attended, 'bg-bad text-[#fff]'],
                        ['no', 'No convocado', !r.called, 'bg-ink-600 text-white'],
                      ] as const).map(([k, label, on, onCls]) => (
                        <button key={k} type="button" aria-pressed={on}
                          onClick={() => upd(s.id, k === 'no' ? { called: false, starter: false } : { called: true, attended: k === 'asistio', ...(k === 'falta' ? { starter: false } : {}) })}
                          className={cx('px-2.5 py-2 sm:px-3', on ? onCls : 'text-muted hover:text-white')}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {r.called && r.attended && (
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-ink-700 pt-3 text-sm sm:grid-cols-[auto_1fr_auto_auto_auto] sm:items-center">
                      <button onClick={() => upd(s.id, { starter: !r.starter })}
                        className={cx('rounded-xl border px-3 py-2 text-sm', r.starter ? 'border-ok bg-ok/15 text-ok' : 'border-ink-600 text-muted')}>
                        {r.starter ? 'Titular' : 'Suplente'}
                      </button>
                      <Input list="positions" value={r.position ?? ''} onChange={(e) => upd(s.id, { position: e.target.value })} placeholder="Posición" className="h-10" aria-label="Posición" />
                      <div className="flex items-center gap-2"><span className="text-xs text-muted">Goles</span><Counter label="goles" value={r.goals} onChange={(v) => upd(s.id, { goals: v })} /></div>
                      <div className="flex items-center gap-2"><span className="text-xs text-muted">Asist.</span><Counter label="asistencias" value={r.assists} onChange={(v) => upd(s.id, { assists: v })} /></div>
                      <div className="flex items-center gap-2"><span className="text-xs text-muted">Min</span>
                        <Input type="number" min="0" max="200" inputMode="numeric" value={r.minutes || ''} onChange={(e) => upd(s.id, { minutes: Math.min(200, Math.max(0, Number(e.target.value) || 0)) })} className="h-10 w-20" aria-label="Minutos jugados" />
                      </div>
                    </div>
                  )}
                  {r.called && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.attended && (
                        <button onClick={() => upd(s.id, { injured: !r.injured })}
                          className={cx('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm', r.injured ? 'border-bad bg-bad/15 text-bad' : 'border-ink-600 text-muted')}>
                          <HeartPulse className="h-4 w-4" /> {r.injured ? 'Se lesionó' : '¿Lesionado?'}
                        </button>
                      )}
                      <Input value={r.notes} onChange={(e) => upd(s.id, { notes: e.target.value })} className="h-10 min-w-0 flex-1"
                        placeholder={r.attended ? 'Nota (comportamiento, lesión, algo a destacar…)' : 'Por qué faltó (opcional)'} aria-label="Nota del niño" />
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      <MatchReportCard match={match} injured={roster.filter((s) => rows[s.id]?.called && rows[s.id]?.injured).map((s) => s.full_name)} />
      <datalist id="positions">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist>
      {editing && <MatchModal match={match} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} danger title="Eliminar partido" confirmLabel="Eliminar"
        text="Se eliminará el partido con su convocatoria y estadísticas. Esta acción no se puede deshacer." />
    </>
  )
}

type TextKey = Exclude<keyof MatchReport, 'photos'>
const REPORT_FIELDS: [TextKey, string, string][] = [
  ['injuries', '¿Hubo lesionados?', 'Quién, qué le pasó y qué se hizo (ej. se torció el tobillo, se le puso hielo, se avisó al papá)'],
  ['kids', 'Comportamiento de los niños', 'Actitud, disciplina, compañerismo…'],
  ['parents', 'Comportamiento de los papás', 'Porra, quejas, algún incidente…'],
  ['referees', 'Árbitros', 'Cómo arbitraron, alguna situación…'],
  ['tournament', 'Torneo / organización', 'Cancha, horarios, organización, otro equipo…'],
  ['other', 'Otras notas', 'Lo que quieras dejar anotado'],
]

/** Reporte al terminar el partido: cómo quedó, lesionados y comportamiento. */
function MatchReportCard({ match, injured }: { match: Match; injured: string[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [gf, setGf] = useState(match.goals_for ?? '')
  const [ga, setGa] = useState(match.goals_against ?? '')
  const [rep, setRep] = useState<MatchReport>(match.report ?? {})
  const [saving, setSaving] = useState(false)
  useEffect(() => { setGf(match.goals_for ?? ''); setGa(match.goals_against ?? ''); setRep(match.report ?? {}) }, [match.id, match.goals_for, match.goals_against, match.report])
  const save = async () => {
    if (gf === '' || ga === '') return toast.error('Escribe cómo quedó el partido.')
    setSaving(true)
    try {
      const clean = Object.fromEntries(Object.entries(rep).filter(([k]) => k !== 'photos').map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v)) as MatchReport
      if (rep.photos?.length) clean.photos = rep.photos
      if (injured.length && !clean.injuries) clean.injuries = injured.join(', ')
      unwrap(await supabase.from('matches').update({ goals_for: Number(gf), goals_against: Number(ga), status: 'jugado', report: clean, report_at: new Date().toISOString() }).eq('id', match.id))
      await qc.invalidateQueries({ queryKey: ['matches'] })
      toast.ok('Reporte del partido guardado')
    } catch (e) { toast.error(e) } finally { setSaving(false) }
  }
  return (
    <Card className="mt-5 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold uppercase tracking-wide"><ClipboardList className="h-5 w-5 text-brand" /> Reporte del partido</h2>
        {match.report_at && <span className="text-xs text-muted">Guardado el {date(match.report_at, "d MMM HH:mm")}</span>}
      </div>
      <p className="text-sm text-muted">Al terminar el partido: cómo quedó, si hubo lesionados y cualquier nota de comportamiento.</p>
      <div className="flex items-end gap-3">
        <Field label="Rancho Seco"><Input type="number" min="0" inputMode="numeric" value={gf} onChange={(e) => setGf(e.target.value)} className="w-24 text-center text-lg font-bold" /></Field>
        <span className="pb-3 text-xl font-bold text-muted">-</span>
        <Field label={match.opponent}><Input type="number" min="0" inputMode="numeric" value={ga} onChange={(e) => setGa(e.target.value)} className="w-24 text-center text-lg font-bold" /></Field>
      </div>
      {injured.length > 0 && <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">Marcados como lesionados: <b>{injured.join(', ')}</b></p>}
      <Field label="Fotos de evidencia (opcional)"><MatchPhotos matchId={match.id} photos={rep.photos ?? []} onChange={(photos) => setRep({ ...rep, photos })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {REPORT_FIELDS.map(([k, label, ph]) => (
          <Field key={k} label={label}><Textarea rows={2} value={rep[k] ?? ''} onChange={(e) => setRep({ ...rep, [k]: e.target.value })} placeholder={ph} /></Field>
        ))}
      </div>
      <div className="flex justify-end"><Button icon={Save} loading={saving} onClick={save}>Guardar reporte</Button></div>
    </Card>
  )
}
