import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Save, Trash2, Users, MapPin, Minus, Plus } from 'lucide-react'
import { Avatar, Button, Card, ConfirmDialog, Empty, ErrorState, Input, Spinner, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { MatchModal, resultBadge } from './Matches'
import { useCategories, useMatchPlayers, useMatches, useStudents } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { date, time } from '@/lib/format'
import type { MatchPlayer } from '@/lib/types'

const POSITIONS = ['Portero', 'Defensa', 'Medio', 'Delantero', 'Ala', 'Pívot', 'Cierre']
type Row = Omit<MatchPlayer, 'match_id' | 'notes'> & { called: boolean }

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
      return [s.id, { student_id: s.id, called: !!p, attended: p?.attended ?? true, starter: p?.starter ?? false, position: p?.position ?? '', goals: p?.goals ?? 0, assists: p?.assists ?? 0, minutes: p?.minutes ?? 0 }]
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
      if (called.length) unwrap(await supabase.from('match_players').upsert(called.map(({ called: _c, ...r }) => ({ ...r, position: r.position || null, match_id: id })), { onConflict: 'match_id,student_id' }))
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
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      <datalist id="positions">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist>
      {editing && <MatchModal match={match} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} danger title="Eliminar partido" confirmLabel="Eliminar"
        text="Se eliminará el partido con su convocatoria y estadísticas. Esta acción no se puede deshacer." />
    </>
  )
}
