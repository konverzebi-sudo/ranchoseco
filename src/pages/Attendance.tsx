import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { startOfMonth } from 'date-fns'
import { Check, X, Clock, FileCheck2, CheckCheck, ClipboardCheck, Download, Plus, Loader2 } from 'lucide-react'
import { Avatar, Badge, Button, Card, Empty, ErrorState, Field, Input, PageHeader, Segmented, Select, Spinner, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useAttendanceDetail, useAttendanceFor, useCategories, useExtraClasses, useStudents, useTrainings } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { ATTENDANCE_LABEL, date, time, toISODate, today } from '@/lib/format'
import { attendanceRate, consecutiveAbsences } from '@/lib/stats'
import { exportCsv } from '@/lib/csv'
import type { AttendanceStatus, Training } from '@/lib/types'

const OPTIONS: { id: AttendanceStatus; label: string; icon: typeof Check; on: string }[] = [
  { id: 'presente', label: 'Presente', icon: Check, on: 'bg-ok text-ink border-ok' },
  { id: 'falta', label: 'Falta', icon: X, on: 'bg-bad text-white border-bad' },
  { id: 'justificada', label: 'Justificada', icon: FileCheck2, on: 'bg-info text-ink border-info' },
  { id: 'retardo', label: 'Retardo', icon: Clock, on: 'bg-warn text-ink border-warn' },
]

const LS_KEY = 'ranchoseco-ultima-categoria'
const readLS = () => { try { return localStorage.getItem(LS_KEY) ?? '' } catch { return '' } }

export default function AttendancePage() {
  const [mode, setMode] = useState<'lista' | 'reporte'>('lista')
  return (
    <>
      <PageHeader title="Asistencias" actions={<Segmented value={mode} onChange={setMode} options={[{ id: 'lista', label: 'Pasar lista' }, { id: 'reporte', label: 'Reportes' }]} />} />
      {mode === 'lista' ? <TakeAttendance /> : <AttendanceReport />}
    </>
  )
}

function TakeAttendance() {
  const categories = useCategories()
  const students = useStudents()
  const qc = useQueryClient()
  const toast = useToast()
  const [cat, setCat] = useState(readLS)
  const [day, setDay] = useState(today())
  const [trainingId, setTrainingId] = useState('')
  const trainings = useTrainings({ categoryId: cat || undefined, from: day, to: day })
  const dayTrainings = cat ? trainings.data ?? [] : []
  const training: Training | undefined = dayTrainings.find((t) => t.id === trainingId) ?? dayTrainings[0]
  const attendance = useAttendanceFor(training?.id)
  const [local, setLocal] = useState<Record<string, AttendanceStatus>>({})
  const [pending, setPending] = useState<Set<string>>(new Set())

  useEffect(() => { try { if (cat) localStorage.setItem(LS_KEY, cat) } catch { /* sin almacenamiento */ } }, [cat])
  useEffect(() => { if (!cat && categories.data?.length) setCat(categories.data[0].id) }, [cat, categories.data])
  useEffect(() => { setLocal({}); setTrainingId('') }, [cat, day])

  const extras = useExtraClasses()
  const isExtra = !!categories.data?.find((c) => c.id === cat)?.is_extra
  const roster = useMemo(() => {
    const members = new Set((extras.data ?? []).filter((x) => x.category_id === cat).map((x) => x.student_id))
    return (students.data ?? []).filter((s) => s.status === 'activo' && (isExtra ? members.has(s.id) : s.category_id === cat))
  }, [students.data, cat, isExtra, extras.data])
  const saved = useMemo(() => new Map((attendance.data ?? []).map((a) => [a.student_id, a.status])), [attendance.data])
  const statusOf = (id: string) => local[id] ?? saved.get(id)
  const marked = roster.filter((s) => statusOf(s.id)).length

  /** Crea el entrenamiento del día si aún no existe (un solo toque para empezar). */
  const creating = useRef<Promise<string> | null>(null)
  useEffect(() => { creating.current = null }, [cat, day])
  const ensureTraining = (): Promise<string> => {
    if (training) return Promise.resolve(training.id)
    creating.current ??= (async () => {
      const created = unwrap(await supabase.from('trainings').insert({ category_id: cat, date: day }).select('*').single()) as Training
      await qc.invalidateQueries({ queryKey: ['trainings'] })
      setTrainingId(created.id)
      return created.id
    })()
    creating.current.catch(() => { creating.current = null })
    return creating.current
  }

  const mark = async (studentIds: string[], status: AttendanceStatus) => {
    const prev = { ...local }
    setLocal((l) => ({ ...l, ...Object.fromEntries(studentIds.map((id) => [id, status])) }))
    setPending((p) => new Set([...p, ...studentIds]))
    try {
      const tid = await ensureTraining()
      unwrap(await supabase.from('attendance').upsert(studentIds.map((student_id) => ({ training_id: tid, student_id, status })), { onConflict: 'training_id,student_id' }))
      qc.invalidateQueries({ queryKey: ['attendance'] })
      if (studentIds.length > 1) toast.ok(`${studentIds.length} alumnos marcados como ${ATTENDANCE_LABEL[status].toLowerCase()}`)
    } catch (e) {
      setLocal(prev)
      toast.error(e)
    } finally {
      setPending((p) => { const n = new Set(p); studentIds.forEach((id) => n.delete(id)); return n })
    }
  }

  if (categories.error) return <ErrorState error={categories.error} />
  if (categories.isLoading || students.isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-2">
          {categories.data?.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className={cx('rounded-xl border px-4 py-2.5 text-sm font-semibold transition', cat === c.id ? 'border-brand bg-brand text-ink' : 'border-ink-600 bg-ink-800 text-muted hover:text-white')}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <Field label="Fecha"><Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value || today())} /></Field>
        <Field label="Entrenamiento">
          {dayTrainings.length > 1 ? (
            <Select value={training?.id} onChange={(e) => { setTrainingId(e.target.value); setLocal({}) }}>
              {dayTrainings.map((t) => <option key={t.id} value={t.id}>{time(t.start_time) || 'Sin hora'} · {t.objectives || 'Entrenamiento'}</option>)}
            </Select>
          ) : (
            <div className="flex h-11 items-center rounded-xl border border-ink-600 bg-ink-900 px-3.5 text-sm text-muted">
              {training ? `${time(training.start_time) || ''} ${training.objectives || 'Entrenamiento del día'}` : 'Se crea automáticamente al marcar al primer alumno'}
            </div>
          )}
        </Field>
      </div>

      {roster.length === 0 ? (
        <Card><Empty icon={ClipboardCheck} title="No hay alumnos activos en esta categoría" action={<Link to="/alumnos?nuevo=1"><Button icon={Plus}>Agregar alumno</Button></Link>} /></Card>
      ) : (
        <>
          <div className="sticky top-[57px] z-20 -mx-4 flex items-center justify-between gap-3 border-b border-ink-600 bg-ink/95 px-4 py-3 backdrop-blur lg:top-0 lg:mx-0 lg:rounded-2xl lg:border">
            <p className="text-sm"><span className="font-display text-2xl font-bold text-brand">{marked}</span><span className="text-muted"> / {roster.length} marcados</span></p>
            <Button size="sm" icon={CheckCheck} onClick={() => mark(roster.filter((s) => !statusOf(s.id)).map((s) => s.id), 'presente')} disabled={marked === roster.length}>
              Resto presentes
            </Button>
          </div>
          <ul className="space-y-2">
            {roster.map((s) => {
              const st = statusOf(s.id)
              return (
                <li key={s.id}>
                  <Card className={cx('p-3 transition', st && 'border-ink-500')}>
                    <div className="mb-2.5 flex items-center gap-3">
                      <Avatar name={s.full_name} path={s.photo_path} size={40} />
                      <Link to={`/alumnos/${s.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">{s.full_name}</Link>
                      {pending.has(s.id) ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : st && <Check className="h-4 w-4 text-ok" aria-label="Guardado" />}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {OPTIONS.map((o) => (
                        <button key={o.id} onClick={() => st !== o.id && mark([s.id], o.id)} aria-pressed={st === o.id}
                          className={cx('flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[11px] font-semibold transition sm:flex-row sm:justify-center sm:gap-1.5 sm:text-sm',
                            st === o.id ? o.on : 'border-ink-600 bg-ink-900 text-muted hover:text-white')}>
                          <o.icon className="h-5 w-5 sm:h-4 sm:w-4" />
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
          {marked === roster.length && <p className="py-2 text-center text-sm text-ok">Lista completa y guardada.</p>}
        </>
      )}
    </div>
  )
}

function AttendanceReport() {
  const categories = useCategories()
  const students = useStudents()
  const [cat, setCat] = useState('')
  const [from, setFrom] = useState(toISODate(startOfMonth(new Date())))
  const [to, setTo] = useState(today())
  const att = useAttendanceDetail({ categoryId: cat || undefined, from, to })
  const allRecent = useAttendanceDetail({ categoryId: cat || undefined, from: toISODate(new Date(Date.now() - 90 * 86400_000)) })

  const rows = useMemo(() => {
    const streaks = consecutiveAbsences(allRecent.data ?? [])
    return (students.data ?? [])
      .filter((s) => s.status === 'activo' && (!cat || s.category_id === cat))
      .map((s) => {
        const list = (att.data ?? []).filter((a) => a.student_id === s.id)
        return {
          s, total: list.length, rate: attendanceRate(list), streak: streaks.get(s.id) ?? 0,
          counts: Object.fromEntries(OPTIONS.map((o) => [o.id, list.filter((a) => a.status === o.id).length])) as Record<AttendanceStatus, number>,
        }
      })
      .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101))
  }, [students.data, att.data, allRecent.data, cat])
  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name ?? ''
  const overall = attendanceRate(att.data ?? [])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_170px_170px_auto] sm:items-end">
        <Field label="Categoría">
          <Select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Todas</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button variant="secondary" icon={Download} disabled={!rows.length}
          onClick={() => exportCsv(`asistencia-${from}-a-${to}.csv`, ['Alumno', 'Categoría', 'Registros', 'Presente', 'Retardo', 'Falta', 'Justificada', '% Asistencia', 'Faltas seguidas'],
            rows.map((r) => [r.s.full_name, catName(r.s.category_id), r.total, r.counts.presente, r.counts.retardo, r.counts.falta, r.counts.justificada, r.rate ?? '', r.streak]))}>
          Exportar
        </Button>
      </div>
      <p className="text-sm text-muted">Del {date(from)} al {date(to)} · Asistencia general: <span className="font-semibold text-brand">{overall != null ? `${overall}%` : '—'}</span></p>
      {att.error ? <ErrorState error={att.error} /> : att.isLoading ? <Spinner /> : (
        <Card className="overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Alumno</th><th>Categoría</th><th>Pres.</th><th>Ret.</th><th>Faltas</th><th>Just.</th><th>% Asistencia</th><th>Faltas seguidas</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.s.id}>
                  <td><Link to={`/alumnos/${r.s.id}?tab=asistencias`} className="font-medium hover:text-brand">{r.s.full_name}</Link></td>
                  <td className="text-muted">{catName(r.s.category_id)}</td>
                  <td>{r.counts.presente}</td><td>{r.counts.retardo}</td><td>{r.counts.falta}</td><td>{r.counts.justificada}</td>
                  <td>{r.rate != null ? <Badge tone={r.rate >= 80 ? 'ok' : r.rate >= 60 ? 'warn' : 'bad'}>{r.rate}%</Badge> : <span className="text-muted">Sin registros</span>}</td>
                  <td>{r.streak >= 2 ? <Badge tone="bad">{r.streak}</Badge> : r.streak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
