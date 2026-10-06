import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { startOfMonth } from 'date-fns'
import { Check, X, Clock, FileCheck2, CheckCheck, ClipboardCheck, Download, Plus, Loader2, ShieldCheck, AlertTriangle, MessageSquare, Save } from 'lucide-react'
import { Avatar, Badge, Button, Card, Empty, ErrorState, Field, Input, PageHeader, Segmented, Select, Spinner, Textarea, cx } from '@/components/ui'
import { useToast } from '@/components/toast'
import { useAttendanceChecks, useAttendanceDetail, useAttendanceFor, useCategories, useExtraClasses, useStudents, useTeam, useTrainings } from '@/lib/api'
import { getActor, getActorId } from '@/lib/actor'
import { useRole } from '@/lib/role'
import { supabase, unwrap } from '@/lib/supabase'
import { ATTENDANCE_LABEL, date, time, toISODate, today } from '@/lib/format'
import { attendanceRate, consecutiveAbsences } from '@/lib/stats'
import { exportCsv } from '@/lib/csv'
import type { AttendanceStatus, Training } from '@/lib/types'

const OPTIONS: { id: AttendanceStatus; label: string; icon: typeof Check; on: string }[] = [
  { id: 'presente', label: 'Presente', icon: Check, on: 'bg-ok text-ink border-ok' },
  { id: 'falta', label: 'Falta', icon: X, on: 'bg-bad text-[#fff] border-bad' },
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

type Who = 'profe' | 'admin'
const WHO_KEY = 'rs-lista-modo'

/** Quién pasa lista en este aparato: si en el equipo es de administración, empieza en "Administración". */
function useDefaultWho(): [Who, (w: Who) => void] {
  const team = useTeam()
  const [who, setWho] = useState<Who | ''>(() => { try { return (localStorage.getItem(WHO_KEY) as Who) || '' } catch { return '' } })
  const me = team.data?.find((m) => m.id === getActorId())
  const auto: Who = me && /admin|direct/i.test(me.role ?? '') ? 'admin' : 'profe'
  const set = (w: Who) => { setWho(w); try { localStorage.setItem(WHO_KEY, w) } catch { /* sin almacenamiento */ } }
  return [who || auto, set]
}

function TakeAttendance() {
  const role = useRole()
  const allCategories = useCategories()
  const categories = { ...allCategories, data: role.isProfe ? allCategories.data?.filter((c) => role.categoryIds.includes(c.id)) : allCategories.data }
  const students = useStudents()
  const qc = useQueryClient()
  const toast = useToast()
  const [whoPicked, setWho] = useDefaultWho()
  // Al profe no se le muestra la lista de administración
  const who = role.isProfe ? 'profe' : whoPicked
  const isAdmin = who === 'admin'
  const [cat, setCat] = useState(readLS)
  const [day, setDay] = useState(today())
  const [trainingId, setTrainingId] = useState('')
  const trainings = useTrainings({ categoryId: cat || undefined, from: day, to: day })
  const dayTrainings = cat ? trainings.data ?? [] : []
  const training: Training | undefined = dayTrainings.find((t) => t.id === trainingId) ?? dayTrainings[0]
  const attendance = useAttendanceFor(training?.id)
  const checks = useAttendanceChecks(training?.id)
  const [local, setLocal] = useState<Record<string, AttendanceStatus | null>>({})
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [noteOpen, setNoteOpen] = useState<string | null>(null)
  const [groupNote, setGroupNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => { try { if (cat) localStorage.setItem(LS_KEY, cat) } catch { /* sin almacenamiento */ } }, [cat])
  useEffect(() => { if ((!cat || !categories.data?.some((c) => c.id === cat)) && categories.data?.length) setCat(categories.data[0].id) }, [cat, categories.data])
  useEffect(() => { setLocal({}); setTrainingId(''); setNoteOpen(null) }, [cat, day, who])
  useEffect(() => { setGroupNote(training?.coach_notes ?? '') }, [training?.id, training?.coach_notes])

  const extras = useExtraClasses()
  const isExtra = !!categories.data?.find((c) => c.id === cat)?.is_extra
  const roster = useMemo(() => {
    const members = new Set((extras.data ?? []).filter((x) => x.category_id === cat).map((x) => x.student_id))
    return (students.data ?? []).filter((s) => (s.status === 'activo' || s.status === 'muestra') && (isExtra ? members.has(s.id) : s.category_id === cat))
  }, [students.data, cat, isExtra, extras.data])
  const official = useMemo(() => new Map((attendance.data ?? []).map((a) => [a.student_id, a])), [attendance.data])
  const adminSaved = useMemo(() => new Map((checks.data ?? []).map((a) => [a.student_id, a.status])), [checks.data])
  const saved = isAdmin ? adminSaved : new Map([...official].map(([k, a]) => [k, a.status]))
  const statusOf = (id: string) => (id in local ? local[id] : saved.get(id)) ?? undefined
  const marked = roster.filter((s) => statusOf(s.id)).length
  // Diferencias entre la lista del profe y la de administración (sólo las ve administración)
  const diffs = roster.filter((s) => { const a = adminSaved.get(s.id); const p = official.get(s.id)?.status; return (a || p) && a !== p })

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
  const table = isAdmin ? 'attendance_checks' : 'attendance'

  const mark = async (studentIds: string[], status: AttendanceStatus) => {
    const prev = { ...local }
    setLocal((l) => ({ ...l, ...Object.fromEntries(studentIds.map((id) => [id, status])) }))
    setPending((p) => new Set([...p, ...studentIds]))
    try {
      const tid = await ensureTraining()
      const rows = studentIds.map((student_id) => ({ training_id: tid, student_id, status, ...(isAdmin ? { actor: getActor() || null, updated_at: new Date().toISOString() } : {}) }))
      unwrap(await supabase.from(table).upsert(rows, { onConflict: 'training_id,student_id' }))
      qc.invalidateQueries({ queryKey: ['attendance'] })
      if (studentIds.length > 1) toast.ok(`${studentIds.length} alumnos marcados como ${ATTENDANCE_LABEL[status].toLowerCase()}`)
    } catch (e) {
      setLocal(prev)
      toast.error(e)
    } finally {
      setPending((p) => { const n = new Set(p); studentIds.forEach((id) => n.delete(id)); return n })
    }
  }

  /** Tocar de nuevo el mismo botón desmarca: se borra el registro de asistencia. */
  const unmark = async (studentId: string) => {
    if (!training) return setLocal((l) => ({ ...l, [studentId]: null }))
    const prev = { ...local }
    setLocal((l) => ({ ...l, [studentId]: null }))
    setPending((p) => new Set([...p, studentId]))
    try {
      unwrap(await supabase.from(table).delete().eq('training_id', training.id).eq('student_id', studentId))
      // Si era un entrenamiento creado solo al pasar lista y ya no tiene a nadie, se quita
      const [{ count }, { count: count2 }] = await Promise.all([
        supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('training_id', training.id),
        supabase.from('attendance_checks').select('student_id', { count: 'exact', head: true }).eq('training_id', training.id),
      ])
      if (count === 0 && !count2 && !training.objectives && !training.exercises && !training.notes && !training.coach_notes) {
        unwrap(await supabase.from('trainings').delete().eq('id', training.id))
        creating.current = null
        setTrainingId('')
        await qc.invalidateQueries({ queryKey: ['trainings'] })
      }
      await qc.invalidateQueries({ queryKey: ['attendance'] })
    } catch (e) {
      setLocal(prev)
      toast.error(e)
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(studentId); return n })
    }
  }

  /** Nota del profe para un niño (se guarda en su asistencia de ese día). */
  const saveKidNote = async (studentId: string, text: string) => {
    if (!training) return
    const cur = official.get(studentId)?.notes ?? ''
    if (text.trim() === cur.trim()) return
    try {
      unwrap(await supabase.from('attendance').update({ notes: text.trim() || null }).eq('training_id', training.id).eq('student_id', studentId))
      await qc.invalidateQueries({ queryKey: ['attendance'] })
      toast.ok('Nota guardada')
    } catch (e) { toast.error(e) }
  }

  const saveGroupNote = async () => {
    setSavingNote(true)
    try {
      const tid = await ensureTraining()
      unwrap(await supabase.from('trainings').update({ coach_notes: groupNote.trim() || null }).eq('id', tid))
      await qc.invalidateQueries({ queryKey: ['trainings'] })
      toast.ok('Notas del entrenamiento guardadas')
    } catch (e) { toast.error(e) } finally { setSavingNote(false) }
  }

  /** Administración: deja como oficial lo que marcó administración. */
  const keepAdminMark = async (studentId: string) => {
    const st = adminSaved.get(studentId)
    if (!training) return
    try {
      if (st) unwrap(await supabase.from('attendance').upsert({ training_id: training.id, student_id: studentId, status: st }, { onConflict: 'training_id,student_id' }))
      else unwrap(await supabase.from('attendance').delete().eq('training_id', training.id).eq('student_id', studentId))
      await qc.invalidateQueries({ queryKey: ['attendance'] })
      toast.ok('Lista oficial corregida')
    } catch (e) { toast.error(e) }
  }

  const verify = async (ok: boolean) => {
    if (!training) return
    try {
      unwrap(await supabase.from('trainings').update(ok ? { verified_at: new Date().toISOString(), verified_by: getActor() || null } : { verified_at: null, verified_by: null }).eq('id', training.id))
      await qc.invalidateQueries({ queryKey: ['trainings'] })
      toast.ok(ok ? 'Lista confirmada' : 'Se quitó la confirmación')
    } catch (e) { toast.error(e) }
  }

  if (categories.error) return <ErrorState error={categories.error} />
  if (categories.isLoading || students.isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      {!role.isProfe && <div className="flex flex-wrap items-center gap-3">
        <Segmented value={who} onChange={setWho} options={[{ id: 'profe', label: 'Lista del profe' }, { id: 'admin', label: 'Lista de administración' }]} />
        <p className="text-xs text-muted">{isAdmin ? 'Administración lleva su propia lista para verificar la del profe.' : 'La lista oficial del entrenamiento.'}</p>
      </div>}

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

      {isAdmin && training && (
        <Card className={cx('flex flex-wrap items-center gap-3 p-4', training.verified_at ? 'border-ok/50' : diffs.length ? 'border-bad/60' : '')}>
          {training.verified_at ? <ShieldCheck className="h-6 w-6 text-ok" /> : diffs.length ? <AlertTriangle className="h-6 w-6 text-bad" /> : <ClipboardCheck className="h-6 w-6 text-brand" />}
          <div className="min-w-0 flex-1 text-sm">
            {training.verified_at
              ? <p className="font-semibold text-ok">Lista confirmada{training.verified_by ? ` por ${training.verified_by}` : ''} · {date(training.verified_at, "d MMM HH:mm")}</p>
              : diffs.length
                ? <p className="font-semibold text-bad">{diffs.length} {diffs.length === 1 ? 'niño no coincide' : 'niños no coinciden'} con la lista del profe. Revisa y corrige.</p>
                : <p className="font-semibold">{official.size ? 'Coincide con la lista del profe.' : 'El profe todavía no pasa lista.'}</p>}
            <p className="text-xs text-muted">Profe: {official.size} marcados · Administración: {adminSaved.size} marcados</p>
          </div>
          {training.verified_at
            ? <Button size="sm" variant="ghost" onClick={() => verify(false)}>Quitar confirmación</Button>
            : <Button size="sm" icon={ShieldCheck} onClick={() => verify(true)} disabled={!official.size}>Confirmar que la lista es correcta</Button>}
        </Card>
      )}
      {isAdmin && training?.coach_notes && <Card className="p-4 text-sm"><p className="mb-1 text-xs font-semibold uppercase text-muted">Nota del profe para el grupo</p>{training.coach_notes}</Card>}

      {roster.length === 0 ? (
        <Card><Empty icon={ClipboardCheck} title="No hay alumnos activos en esta categoría" action={<Link to="/alumnos?nuevo=1"><Button icon={Plus}>Agregar alumno</Button></Link>} /></Card>
      ) : (
        <>
          <div className="sticky top-[57px] z-20 -mx-4 flex items-center justify-between gap-3 border-b border-ink-600 bg-page/95 px-4 py-3 backdrop-blur lg:top-0 lg:mx-0 lg:rounded-2xl lg:border">
            <p className="text-sm"><span className="font-display text-2xl font-bold text-brand">{marked}</span><span className="text-muted"> / {roster.length} marcados{isAdmin ? ' (administración)' : ''}</span><span className="block text-xs text-muted">Toca de nuevo una opción para desmarcarla</span></p>
            <Button size="sm" icon={CheckCheck} onClick={() => mark(roster.filter((s) => !statusOf(s.id)).map((s) => s.id), 'presente')} disabled={marked === roster.length}>
              Resto presentes
            </Button>
          </div>
          <ul className="space-y-2">
            {roster.map((s) => {
              const st = statusOf(s.id)
              const prof = official.get(s.id)
              const mismatch = isAdmin && diffs.some((d) => d.id === s.id)
              return (
                <li key={s.id}>
                  <Card className={cx('p-3 transition', st && 'border-ink-500', mismatch && 'border-bad/70')}>
                    <div className="mb-2.5 flex items-center gap-3">
                      <Avatar name={s.full_name} path={s.photo_path} size={40} />
                      <Link to={`/alumnos/${s.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">{s.full_name}</Link>
                      {s.status === 'muestra' && <Badge tone="info">Clase muestra</Badge>}
                      {!isAdmin && prof && (
                        <button onClick={() => setNoteOpen(noteOpen === s.id ? null : s.id)} className={cx('rounded-lg p-1.5', prof.notes ? 'text-brand' : 'text-muted hover:text-fg')} aria-label="Nota del niño" title="Nota del niño">
                          <MessageSquare className="h-4 w-4" />
                        </button>
                      )}
                      {pending.has(s.id) ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : st && <Check className="h-4 w-4 text-ok" aria-label="Guardado" />}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {OPTIONS.map((o) => (
                        <button key={o.id} onClick={() => (st === o.id ? unmark(s.id) : mark([s.id], o.id))} aria-pressed={st === o.id} title={st === o.id ? 'Tocar de nuevo para desmarcar' : undefined}
                          className={cx('flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[11px] font-semibold transition sm:flex-row sm:justify-center sm:gap-1.5 sm:text-sm',
                            st === o.id ? o.on : 'border-ink-600 bg-ink-900 text-muted hover:text-white')}>
                          <o.icon className="h-5 w-5 sm:h-4 sm:w-4" />
                          {o.label}
                        </button>
                      ))}
                    </div>
                    {isAdmin && (prof || mismatch) && (
                      <div className={cx('mt-2 flex flex-wrap items-center gap-2 text-xs', mismatch ? 'text-bad' : 'text-muted')}>
                        <span>Profe: <b>{prof ? ATTENDANCE_LABEL[prof.status] : 'sin marcar'}</b>{mismatch ? ' · no coincide' : ''}</span>
                        {mismatch && <button onClick={() => keepAdminMark(s.id)} className="rounded-lg border border-bad/50 px-2 py-0.5 font-semibold hover:bg-bad/10">Dejar la de administración como oficial</button>}
                        {prof?.notes && <span className="w-full text-muted">Nota del profe: {prof.notes}</span>}
                      </div>
                    )}
                    {!isAdmin && noteOpen === s.id && prof && (
                      <div className="mt-2">
                        <Textarea rows={2} autoFocus defaultValue={prof.notes ?? ''} onBlur={(e) => saveKidNote(s.id, e.target.value)}
                          placeholder={`Nota sobre ${s.full_name.split(' ')[0]} (ej. trabajó muy bien el pase, llegó lastimado…)`} />
                        <p className="mt-1 text-[11px] text-muted">Se guarda al salir del cuadro. Los papás la ven en el reporte del mes.</p>
                      </div>
                    )}
                    {!isAdmin && noteOpen !== s.id && prof?.notes && <p className="mt-2 text-xs text-muted">📝 {prof.notes}</p>}
                  </Card>
                </li>
              )
            })}
          </ul>
          {marked === roster.length && <p className="py-2 text-center text-sm text-ok">Lista completa y guardada.</p>}
          {!isAdmin && (
            <Card className="space-y-2 p-4">
              <p className="font-semibold">Notas del entrenamiento (para todo el grupo)</p>
              <Textarea rows={3} value={groupNote} onChange={(e) => setGroupNote(e.target.value)} placeholder="Ej. Trabajamos salida con balón; el grupo estuvo muy concentrado; faltaron conos…" />
              <div className="flex justify-end"><Button size="sm" icon={Save} loading={savingNote} onClick={saveGroupNote} disabled={groupNote.trim() === (training?.coach_notes ?? '').trim()}>Guardar notas</Button></div>
            </Card>
          )}
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
