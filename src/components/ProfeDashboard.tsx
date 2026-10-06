import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, ClipboardCheck, Dumbbell, Star, Trophy, UserX, Users } from 'lucide-react'
import { Badge, Button, Card, PageHeader, StatCard } from './ui'
import BirthdaysCard from './Birthdays'
import CoachNotes from './CoachNotes'
import { CategoryRequestsCard } from './CategoryChange'
import { scheduleText, type Slot } from '@/lib/schedule'
import { useAttendanceDetail, useCategories, useMatches, useStudents, useTrainings } from '@/lib/api'
import { usePlayerEvaluations } from '@/lib/evalApi'
import { consecutiveAbsences } from '@/lib/stats'
import { date, time, today, toISODate } from '@/lib/format'

/** Dashboard del profe: sólo lo de sus categorías, sin dinero. */
export default function ProfeDashboard({ name, categoryIds, myCategoryIds = [], coordinator }: { name: string; categoryIds: string[]; myCategoryIds?: string[]; coordinator?: boolean }) {
  const nav = useNavigate()
  const t = today()
  const cats = useCategories()
  const students = useStudents()
  const trainings = useTrainings({ from: t })
  const matches = useMatches({ from: t })
  const recent = useAttendanceDetail({ from: toISODate(new Date(Date.now() - 60 * 86400_000)) })
  const evals = usePlayerEvaluations()
  const mine = (id: string | null) => !!id && categoryIds.includes(id)
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? ''

  const d = useMemo(() => {
    const kids = (students.data ?? []).filter((s) => (s.status === 'activo' || s.status === 'muestra') && mine(s.category_id))
    const ids = new Set(kids.map((s) => s.id))
    const att = (recent.data ?? []).filter((a) => ids.has(a.student_id))
    const todayAtt = att.filter((a) => a.date === t)
    const streaks = consecutiveAbsences(att)
    const absent = kids.map((s) => ({ s, n: streaks.get(s.id) ?? 0 })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n)
    const since = toISODate(new Date(Date.now() - 45 * 86400_000))
    const evaluated = new Set((evals.data ?? []).filter((e) => e.evaluated_on >= since).map((e) => e.student_id))
    const toEvaluate = kids.filter((s) => s.status === 'activo' && !evaluated.has(s.id))
    const agenda = [
      ...(trainings.data ?? []).filter((x) => mine(x.category_id)).map((x) => ({ kind: 'tr' as const, id: x.id, date: x.date, time: x.start_time, cat: x.category_id, title: x.objectives || 'Entrenamiento' })),
      ...(matches.data ?? []).filter((x) => mine(x.category_id) && x.status === 'programado').map((x) => ({ kind: 'ma' as const, id: x.id, date: x.date, time: x.time, cat: x.category_id, title: `vs ${x.opponent}` })),
    ].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? ''))).slice(0, 8)
    const trainingToday = agenda.find((a) => a.kind === 'tr' && a.date === t)
    // Coordinador: "Mis alumnos" son los de sus categorías; aparte el total de la academia
    const own = coordinator ? kids.filter((s) => s.category_id && myCategoryIds.includes(s.category_id)) : kids
    return { kids, own, todayAtt, absent, toEvaluate, agenda, trainingToday }
  }, [students.data, recent.data, evals.data, trainings.data, matches.data, categoryIds, myCategoryIds, coordinator, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const present = d.todayAtt.filter((a) => a.status === 'presente' || a.status === 'retardo').length
  return (
    <>
      <PageHeader title={`Hola, ${name.replace(/^prof\.?\s*/i, '').split(' ')[0] || 'profe'}`} subtitle={`${date(t, "EEEE d 'de' MMMM")} · ${coordinator ? 'Coordinador · todas las categorías' : categoryIds.map(catName).filter(Boolean).join(', ') || 'Sin categorías asignadas'}`}
        actions={<><Button icon={ClipboardCheck} onClick={() => nav('/asistencias')}>Pasar lista</Button><Button variant="secondary" icon={Star} onClick={() => nav('/evaluaciones')}>Evaluar</Button></>} />
      {!categoryIds.length && <Card className="mb-4 p-4 text-sm text-warn">Todavía no tienes categorías asignadas. Pídele a administración que te asigne en Categorías → Profesor de la categoría.</Card>}
      <div className="space-y-6">
        <div className={coordinator ? "grid grid-cols-2 gap-3 lg:grid-cols-5" : "grid grid-cols-2 gap-3 lg:grid-cols-4"}>
          <StatCard label="Mis alumnos" value={d.own.length} icon={Users} hint={coordinator ? `De mis categorías · ${d.own.filter((s) => s.status === 'muestra').length} en clase muestra` : `${d.kids.filter((s) => s.status === 'muestra').length} en clase muestra`} />
          {coordinator && <StatCard label="Total de alumnos" value={d.kids.length} icon={Users} hint="Todas las categorías" />}
          <StatCard label="Asistencia de hoy" value={d.todayAtt.length ? `${present}/${d.todayAtt.length}` : '—'} icon={ClipboardCheck} hint={d.trainingToday ? 'Hoy hay entrenamiento' : 'Hoy no hay entrenamiento'} onClick={() => nav('/asistencias')} />
          <StatCard label="Faltas seguidas" value={d.absent.length} icon={UserX} tone={d.absent.length ? 'bad' : undefined} hint="2 o más faltas seguidas" />
          <StatCard label="Por evaluar" value={d.toEvaluate.length} icon={Star} hint="Sin evaluación en 45 días" onClick={() => nav('/evaluaciones')} />
        </div>
        {coordinator && <CategoryRequestsCard />}
        <MySchedule categoryIds={coordinator ? (myCategoryIds.length ? myCategoryIds : categoryIds) : categoryIds} title={coordinator ? 'Horarios de entrenamiento' : 'Mis categorías y horarios'} all={coordinator} />
        <BirthdaysCard categoryIds={categoryIds} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
              <h2 className="font-display text-lg font-bold uppercase tracking-wide">Próximas actividades</h2>
              <Link to="/calendario" className="text-sm text-brand hover:underline">Calendario</Link>
            </div>
            {!d.agenda.length ? <p className="px-5 py-8 text-center text-sm text-muted">No hay entrenamientos ni partidos programados.</p> : (
              <ul className="divide-y divide-ink-700">
                {d.agenda.map((a) => (
                  <li key={a.kind + a.id}>
                    <Link to={a.kind === 'ma' ? `/partidos/${a.id}` : '/asistencias'} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-700/50">
                      <div className={`rounded-xl p-2 ${a.kind === 'ma' ? 'bg-brand text-ink' : 'bg-ink-700 text-brand'}`}>{a.kind === 'ma' ? <Trophy className="h-4 w-4" /> : <Dumbbell className="h-4 w-4" />}</div>
                      <div className="min-w-0 flex-1"><p className="truncate font-medium">{a.title}</p><p className="text-xs text-muted">{catName(a.cat)} · {date(a.date, 'EEE d MMM')} {time(a.time)}</p></div>
                      {a.date === t && <Badge tone="brand">Hoy</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-4"><CalendarDays className="h-5 w-5 text-brand" /><h2 className="font-display text-lg font-bold uppercase tracking-wide">Requieren atención</h2></div>
            {!d.absent.length && !d.toEvaluate.length ? <p className="px-5 py-8 text-center text-sm text-muted">Todo en orden.</p> : (
              <ul className="max-h-80 divide-y divide-ink-700 overflow-y-auto">
                {d.absent.map(({ s, n }) => (
                  <li key={'a' + s.id}><Link to={`/alumnos/${s.id}?tab=asistencias`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-ink-700/50"><span>{s.full_name} <span className="text-xs text-muted">· {catName(s.category_id ?? '')}</span></span><Badge tone="bad">{n} faltas seguidas</Badge></Link></li>
                ))}
                {d.toEvaluate.slice(0, 15).map((s) => (
                  <li key={'e' + s.id}><Link to={`/evaluaciones?alumno=${s.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-ink-700/50"><span>{s.full_name} <span className="text-xs text-muted">· {catName(s.category_id ?? '')}</span></span><Badge>Evaluar</Badge></Link></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <CoachNotes />
      </div>
    </>
  )
}

/** Las categorías del profe y qué días entrenan (en cuanto registren su horario). */
function MySchedule({ categoryIds, title, all }: { categoryIds: string[]; title: string; all?: boolean }) {
  const cats = useCategories()
  const list = (cats.data ?? []).filter((c) => c.active && (all || categoryIds.includes(c.id)))
  if (!list.length) return null
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><CalendarDays className="h-5 w-5 text-brand" /> {title}</h2>
        <Link to="/entrenamientos" className="text-sm text-brand hover:underline">Horario semanal</Link>
      </div>
      <ul className="divide-y divide-ink-700">
        {list.map((c) => {
          const slots = (c.weekly_schedule ?? []) as Slot[]
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <b>{c.name}</b>
              {slots.length ? <span className="text-muted">{scheduleText(slots)}</span> : <Link to="/entrenamientos" className="text-warn hover:underline">Falta registrar su horario</Link>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
