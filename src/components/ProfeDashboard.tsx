import { useMemo } from 'react'
import { addDays, endOfMonth, startOfWeek } from 'date-fns'
import { Link, useNavigate } from 'react-router-dom'
import { CakeSlice, CalendarDays, ClipboardCheck, Dumbbell, Plus, Star, Trophy, UserX, Users } from 'lucide-react'
import { Badge, Button, Card, PageHeader, StatCard } from './ui'
import BirthdaysCard, { birthdaysOn } from './Birthdays'
import { Gauge, GaugeGrid } from './Gauges'
import CoachNotes from './CoachNotes'
import { CategoryRequestsCard } from './CategoryChange'
import { scheduleText, type Slot } from '@/lib/schedule'
import { useAttendanceDetail, useCategories, useFees, useMatches, useStudents, useTrainings } from '@/lib/api'
import { datesFor } from '@/lib/schedule'
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
  const fees = useFees()
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
    // Pagos por categoría: qué % de niños ya pagó la mensualidad del mes (sin cantidades de dinero)
    const period = t.slice(0, 8) + '01'
    const monthFees = (fees.data ?? []).filter((f) => f.concept === 'Mensualidad' && f.period === period)
    const payByCat = (cats.data ?? []).filter((c) => !c.is_extra && mine(c.id)).map((c) => {
      const ks = new Set(kids.filter((s) => s.status === 'activo' && s.category_id === c.id).map((s) => s.id))
      const fs = monthFees.filter((f) => ks.has(f.student_id))
      const paid = fs.filter((f) => Number(f.balance) <= 0).length
      return { id: c.id, name: c.name, total: fs.length, paid, pct: fs.length ? (paid / fs.length) * 100 : 0 }
    }).filter((x) => x.total > 0)
    return { kids, own, todayAtt, absent, toEvaluate, agenda, trainingToday, payByCat }
  }, [students.data, recent.data, evals.data, trainings.data, matches.data, fees.data, cats.data, categoryIds, myCategoryIds, coordinator, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const present = d.todayAtt.filter((a) => a.status === 'presente' || a.status === 'retardo').length
  const monthEnd = toISODate(endOfMonth(new Date(t + 'T12:00:00')))
  const evalFrom = toISODate(addDays(new Date(monthEnd + 'T12:00:00'), -6))
  const evalWeek = t >= evalFrom
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
        <MySchedule categoryIds={categoryIds} mine={coordinator ? myCategoryIds : []} title={coordinator ? 'Horarios de entrenamiento' : 'Mis categorías y horarios'} all={coordinator} />
        <BirthdaysCard categoryIds={categoryIds} />
        <GaugeGrid title={`Pagos por categoría · ${date(t, 'MMMM')}`} subtitle="Qué tantos niños ya pagaron la mensualidad del mes">
          {d.payByCat.length ? d.payByCat.map((c) => <Gauge key={c.id} pct={c.pct} label={c.name} sub={`${c.paid} de ${c.total} pagaron`} />)
            : <p className="col-span-full text-sm text-muted">Todavía no hay mensualidades de este mes.</p>}
        </GaugeGrid>

        {evalWeek && (
          <Card className="border-brand/60">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-4">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><Star className="h-5 w-5 text-brand" /> Realiza tu evaluación mensual</h2>
              <span className="text-sm text-muted">Antes del {date(monthEnd, "d 'de' MMMM")} · faltan {d.toEvaluate.length}</span>
            </div>
            {!d.toEvaluate.length ? <p className="px-5 py-6 text-center text-sm text-ok">¡Ya evaluaste a todos este mes!</p> : (
              <ul className="max-h-96 divide-y divide-ink-700 overflow-y-auto">
                {d.toEvaluate.map((s) => (
                  <li key={s.id}><Link to={`/evaluaciones?alumno=${s.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 hover:bg-ink-700/50"><span>{s.full_name} <span className="text-sm text-muted">· {catName(s.category_id ?? '')}</span></span><Badge tone="brand">Evaluar</Badge></Link></li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-4">
            <h2 className="font-display text-lg font-bold uppercase tracking-wide">Próximas actividades</h2>
            <Link to="/calendario" className="text-sm text-brand hover:underline">Calendario</Link>
          </div>
          {!d.agenda.length ? <p className="px-5 py-6 text-center text-sm text-muted">No hay entrenamientos ni partidos programados.</p> : (
            <ul className="divide-y divide-ink-700">
              {d.agenda.map((a) => (
                <li key={a.kind + a.id}>
                  <Link to={a.kind === 'ma' ? `/partidos/${a.id}` : '/asistencias'} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-700/50">
                    <div className={`rounded-xl p-2 ${a.kind === 'ma' ? 'bg-brand text-ink' : 'bg-ink-700 text-brand'}`}>{a.kind === 'ma' ? <Trophy className="h-4 w-4" /> : <Dumbbell className="h-4 w-4" />}</div>
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{a.title}</p><p className="text-sm text-muted">{catName(a.cat)} · {date(a.date, 'EEE d MMM')} {time(a.time)}</p></div>
                    {a.date === t && <Badge tone="brand">Hoy</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 border-t border-ink-600 p-4 sm:grid-cols-3">
            <Button icon={Trophy} variant="secondary" onClick={() => nav('/partidos?nuevo=1')}>Agregar partido</Button>
            <Button icon={Dumbbell} variant="secondary" onClick={() => nav('/entrenamientos?nuevo=1')}>Agregar entrenamiento</Button>
            <Button icon={Plus} variant="secondary" onClick={() => nav('/evaluaciones')}>Agregar evaluación</Button>
          </div>
        </Card>

        <WeekCalendar categoryIds={categoryIds} evalFrom={evalFrom} monthEnd={monthEnd} />
        <CoachNotes />
      </div>
    </>
  )
}

/** Las categorías del profe y qué días entrenan (en cuanto registren su horario). */
function MySchedule({ categoryIds, title, all, mine = [] }: { categoryIds: string[]; title: string; all?: boolean; mine?: string[] }) {
  const cats = useCategories()
  // Las suyas primero (el coordinador ve todas, con las suyas marcadas)
  const list = (cats.data ?? []).filter((c) => c.active && (all || categoryIds.includes(c.id))).sort((a, b) => Number(mine.includes(b.id)) - Number(mine.includes(a.id)))
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
            <li key={c.id} className={"flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm" + (mine.includes(c.id) ? ' bg-brand-dim' : '')}>
              <span className="flex items-center gap-2"><b>{c.name}</b>{mine.includes(c.id) && <Badge tone="brand">Mi categoría</Badge>}</span>
              {slots.length ? <span className="text-muted">{scheduleText(slots)}</span> : <Link to="/entrenamientos" className="text-warn hover:underline">Falta registrar su horario</Link>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** La semana en calendario: entrenamientos, partidos, cumpleaños y días de evaluación mensual. */
function WeekCalendar({ categoryIds, evalFrom, monthEnd }: { categoryIds: string[]; evalFrom: string; monthEnd: string }) {
  const t = today()
  const monday = startOfWeek(new Date(t + 'T12:00:00'), { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(monday, i)))
  const cats = useCategories()
  const students = useStudents()
  const trainings = useTrainings({ from: days[0], to: days[6] })
  const matches = useMatches({ from: days[0], to: days[6] })
  const mine = (id: string | null) => !!id && categoryIds.includes(id)
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? ''
  const kids = (students.data ?? []).filter((s) => s.status === 'activo' && mine(s.category_id))
  // Entrenamientos: los registrados y los del horario semanal de sus categorías
  const slots = (cats.data ?? []).filter((c) => mine(c.id)).flatMap((c) => datesFor((c.weekly_schedule ?? []) as Slot[], days[0], days[6]).map((x) => ({ date: x.date, cat: c.id })))
  const trainingDays = new Map<string, Set<string>>()
  for (const x of [...slots, ...(trainings.data ?? []).filter((x) => mine(x.category_id)).map((x) => ({ date: x.date, cat: x.category_id }))]) trainingDays.set(x.date, new Set([...(trainingDays.get(x.date) ?? []), catName(x.cat)]))
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><CalendarDays className="h-5 w-5 text-brand" /> Mi semana</h2>
        <span className="flex flex-wrap gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><Dumbbell className="h-3.5 w-3.5 text-brand" /> Entrenamiento</span>
          <span className="flex items-center gap-1"><Trophy className="h-3.5 w-3.5 text-warn" /> Partido</span>
          <span className="flex items-center gap-1"><CakeSlice className="h-3.5 w-3.5 text-info" /> Cumpleaños</span>
          <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-ok" /> Evaluación</span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-px bg-ink-600 sm:grid-cols-7">
        {days.map((day) => {
          const ms = (matches.data ?? []).filter((m) => m.date === day && mine(m.category_id) && m.status !== 'cancelado')
          const bd = birthdaysOn(kids, day)
          const tr = [...(trainingDays.get(day) ?? [])]
          const ev = day >= evalFrom && day <= monthEnd
          return (
            <div key={day} className={'min-h-[8rem] space-y-1.5 bg-ink-800 p-2.5' + (day === t ? ' ring-2 ring-inset ring-brand' : '')}>
              <p className={'text-sm font-semibold capitalize' + (day === t ? ' text-brand' : '')}>{date(day, 'EEE d')}{day === t && ' · hoy'}</p>
              {tr.map((c) => <p key={c} className="flex items-center gap-1 rounded-md bg-brand-dim px-1.5 py-0.5 text-xs"><Dumbbell className="h-3.5 w-3.5 shrink-0 text-brand" />{c}</p>)}
              {ms.map((m) => <Link key={m.id} to={`/partidos/${m.id}`} className="flex items-center gap-1 rounded-md bg-warn/15 px-1.5 py-0.5 text-xs hover:underline"><Trophy className="h-3.5 w-3.5 shrink-0 text-warn" />vs {m.opponent}{m.time ? ` · ${time(m.time)}` : ''}</Link>)}
              {bd.map((s) => <p key={s.id} className="flex items-center gap-1 rounded-md bg-info/15 px-1.5 py-0.5 text-xs"><CakeSlice className="h-3.5 w-3.5 shrink-0 text-info" />{s.full_name.split(' ')[0]}</p>)}
              {ev && <Link to="/evaluaciones" className="flex items-center gap-1 rounded-md bg-ok/15 px-1.5 py-0.5 text-xs hover:underline"><Star className="h-3.5 w-3.5 shrink-0 text-ok" />Evaluación mensual</Link>}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
