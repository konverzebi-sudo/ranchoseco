import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { endOfWeek, startOfMonth } from 'date-fns'
import { ClipboardCheck, AlertTriangle, Wallet, Plus, ChevronRight, Trophy, Dumbbell, Scale, CalendarClock, Bell } from 'lucide-react'
import { Avatar, Button, Card, ErrorState, PageHeader, Spinner, Badge } from '@/components/ui'
import { CollectButton } from '@/components/WhatsAppButtons'
import { monthNameOf, useCashBoxCards } from '@/components/FinanceModules'
import { FundGauges, ProfeGauges } from '@/components/FundProgress'
import { Gauge, GaugeGrid } from '@/components/Gauges'
import PeriodCards, { usePeriod } from '@/components/PeriodCards'
import BreakEvenCard from '@/components/BreakEven'
import { PayInstallmentModal } from '@/components/Installments'
import { CloseTrialModal } from '@/components/TrialModals'
import ActivityFeed from '@/components/ActivityFeed'
import ProfeDashboard from '@/components/ProfeDashboard'
import { useRole } from '@/lib/role'
import { QuestionsStatus, QuestionsToAnswer } from '@/components/Questions'
import { isJany } from '@/components/Team'
import CoachNotes from '@/components/CoachNotes'
import { MatchReportsCard } from '@/components/MatchPhotos'
import { CategoryRequestsCard } from '@/components/CategoryChange'
import { ProfileRequestsCard } from '@/components/ProfileEdit'
import { CashDoubtsCard } from '@/components/CashDoubts'
import IncomeBreakdownModal from '@/components/IncomeBreakdown'
import CardDetailModal, { type CardKind } from '@/components/CardDetails'
import BirthdaysCard from '@/components/Birthdays'
import { UnpaidDeliveries } from '@/components/Deliveries'
import OverpaidAlert from '@/components/OverpaidAlert'
import { pendingInstallments } from '@/lib/finance'
import type { Expense, ExpenseInstallment } from '@/lib/types'
import { useAccounts, useCategories, useFees, useMatches, usePayments, useSiblingGroups, useExtraClasses, useStudents, useTrainings, useAttendanceDetail, useExpenses, useNotifications, type StudentRow } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import { promoStatus } from '@/lib/siblings'
import { date, money, time, toISODate, today } from '@/lib/format'
import { consecutiveAbsences } from '@/lib/stats'

/** Junta a los hermanos en un solo renglón (un adeudo por familia). */
function byFamily<T extends { acc: { balance: number | string }; s: StudentRow }>(rows: T[]) {
  const m = new Map<string, T[]>()
  for (const r of rows) { const k = r.s.sibling_group_id ?? r.s.id; m.set(k, [...(m.get(k) ?? []), r]) }
  return [...m.values()].map((list) => ({ list, total: list.reduce((a, r) => a + Number(r.acc.balance), 0) })).sort((a, b) => b.total - a.total)
}

export default function Dashboard() {
  const role = useRole()
  if (!role.ready) return <Spinner />
  return role.isProfe ? <ProfeDashboard name={role.name} categoryIds={role.categoryIds} myCategoryIds={role.myCategoryIds} coordinator={role.isCoordinator} /> : <AdminDashboard />
}

function AdminDashboard() {
  const role = useRole()
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [detail, setDetail] = useState<CardKind | null>(null)
  const nav = useNavigate()
  const monthStart = toISODate(startOfMonth(new Date()))
  const t = today()
  const students = useStudents()
  const categories = useCategories()
  const accounts = useAccounts()
  const fees = useFees()
  const payments = usePayments(undefined, monthStart)
  const upcomingTr = useTrainings({ from: t })
  const upcomingMa = useMatches({ from: t })
  const siblingGroups = useSiblingGroups()
  const extraClasses = useExtraClasses()
  const expenses = useExpenses()
  const [paying, setPaying] = useState<{ expense: Expense; inst: ExpenseInstallment } | null>(null)
  const [closing, setClosing] = useState<StudentRow | null>(null)
  const notes = useNotifications()
  const qc = useQueryClient()
  const markSeen = async (ids: string[]) => {
    try {
      unwrap(await supabase.from('notifications').update({ seen_at: new Date().toISOString() }).in('id', ids))
      await qc.invalidateQueries({ queryKey: ['notifications'] })
    } catch { /* se reintenta la próxima vez */ }
  }
  const boxes = useCashBoxCards(setDetail)
  const { period, bar: periodBar } = usePeriod()
  const mes = monthNameOf(monthStart)
  const weekEnd = toISODate(endOfWeek(new Date(), { weekStartsOn: 1 }))
  const dueTasks = pendingInstallments(expenses.data ?? [], weekEnd)
  const recentAtt = useAttendanceDetail({ from: toISODate(new Date(Date.now() - 60 * 86400_000)) })

  const data = useMemo(() => {
    const active = (students.data ?? []).filter((s) => s.status === 'activo')
    const activeIds = new Set(active.map((s) => s.id))
    const extraMembers = (id: string) => new Set((extraClasses.data ?? []).filter((x) => x.category_id === id).map((x) => x.student_id))
    const byCategory = (categories.data ?? []).map((c) => ({ ...c, count: c.is_extra ? active.filter((s) => extraMembers(c.id).has(s.id)).length : active.filter((s) => s.category_id === c.id).length }))
    const noCat = active.filter((s) => !s.category_id).length
    // Pagos de la mensualidad del mes por categoría: cuántos ya pagaron y cuánto falta
    const monthFees = (fees.data ?? []).filter((f) => f.concept === 'Mensualidad' && f.period === period.to.slice(0, 7) + '-01' && activeIds.has(f.student_id))
    const catOfStudent = new Map(active.map((s) => [s.id, s.category_id]))
    const payByCategory = (categories.data ?? []).filter((c) => !c.is_extra).map((c) => {
      const fs = monthFees.filter((f) => catOfStudent.get(f.student_id) === c.id)
      const due = fs.reduce((a, f) => a + Number(f.total_due), 0)
      const paid = fs.reduce((a, f) => a + Math.min(Number(f.paid), Number(f.total_due)), 0)
      return { id: c.id, name: c.name, students: fs.length, paidCount: fs.filter((f) => Number(f.balance) <= 0).length, due, paid, pct: due > 0 ? (paid / due) * 100 : 0 }
    }).filter((x) => x.students > 0)
    // Alumnos con adeudo: activos que deben algo (cualquier mes)
    const owing = new Set((fees.data ?? []).filter((f) => Number(f.balance) > 0 && f.status !== 'por_confirmar' && activeIds.has(f.student_id)).map((f) => f.student_id))
    const todayAtt = (recentAtt.data ?? []).filter((a) => a.date === t)
    const present = todayAtt.filter((a) => a.status === 'presente' || a.status === 'retardo').length
    const openFees = (fees.data ?? []).filter((f) => Number(f.balance) > 0 && activeIds.has(f.student_id))
    const pendingTotal = openFees.reduce((s, f) => s + Number(f.balance), 0)
    const lateFees = openFees.reduce((s, f) => s + Number(f.late_fee), 0)
    const extras = openFees.filter((f) => f.concept !== 'Mensualidad').reduce((s, f) => s + Number(f.balance), 0)
    const reviewTotal = openFees.filter((f) => f.status === 'por_confirmar').reduce((s, f) => s + Number(f.balance), 0)
    const collected = (payments.data ?? []).reduce((s, p) => s + Number(p.amount), 0)
    const overdueStudents = (accounts.data ?? [])
      .filter((a) => a.status === 'vencido' && activeIds.has(a.student_id))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue))
      .map((a) => ({ acc: a, s: active.find((s) => s.id === a.student_id)! }))
    const streaks = consecutiveAbsences(recentAtt.data ?? [])
    const absent = active.map((s) => ({ s, n: streaks.get(s.id) ?? 0 })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n)
    const overdueSet = new Set((accounts.data ?? []).filter((a) => a.status === 'vencido').map((a) => a.student_id))
    const promoAlerts = (siblingGroups.data ?? []).map((g) => {
      const members = (students.data ?? []).filter((s) => s.sibling_group_id === g.id)
      return { g, ...promoStatus(members, overdueSet) }
    }).filter((r) => !r.valid || r.overdue.length)
    return { promoAlerts, active, byCategory, payByCategory, owing, noCat, todayAtt, present, openFees, pendingTotal, lateFees, extras, reviewTotal, collected, overdueStudents, absent }
  }, [students.data, categories.data, recentAtt.data, fees.data, payments.data, accounts.data, t, monthStart, siblingGroups.data, extraClasses.data, period.to])

  const trials = (students.data ?? []).filter((s) => s.status === 'muestra')
  const loading = students.isLoading || accounts.isLoading || fees.isLoading
  const error = students.error || accounts.error || fees.error || categories.error
  if (error) return <><PageHeader title="Dashboard" /><ErrorState error={error} onRetry={() => { students.refetch(); accounts.refetch(); fees.refetch(); categories.refetch() }} /></>

  const agenda = [
    ...(upcomingTr.data ?? []).map((x) => ({ kind: 'tr' as const, date: x.date, time: x.start_time, cat: x.category_id, title: x.objectives || 'Entrenamiento', id: x.id })),
    ...(upcomingMa.data ?? []).filter((m) => m.status === 'programado').map((x) => ({ kind: 'ma' as const, date: x.date, time: x.time, cat: x.category_id, title: `vs ${x.opponent}`, id: x.id })),
  ].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? ''))).slice(0, 6)
  const catName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? ''

  return (
    <>
      <PageHeader title="Dashboard" subtitle={date(t, "EEEE d 'de' MMMM")} bar={periodBar}
        actions={<>
          <Button icon={ClipboardCheck} onClick={() => nav('/asistencias')}>Pasar lista</Button>
          <Button variant="secondary" icon={Wallet} onClick={() => nav('/cobranza')}>Registrar pago</Button>
          <Button variant="secondary" icon={Scale} onClick={() => nav('/corte')}>Corte de caja</Button>
          <Button variant="secondary" icon={Plus} onClick={() => nav('/alumnos?nuevo=1')} className="hidden sm:inline-flex">Nuevo alumno</Button>
        </>} />

      {loading ? <Spinner /> : (
        <div className="space-y-6">
          {/* Preguntas de sistemas: Aby las contesta; Jany ve cómo van y las respuestas */}
          {/^aby/i.test(role.meName) && <QuestionsToAnswer person="Aby" />}
          {isJany(role.realName) && !role.viewingAs && <QuestionsStatus person="Aby" />}
          {!!notes.data?.length && (
            <Card className="border-warn/50">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><Bell className="h-5 w-5 text-warn" /> Cambios en la caja ({notes.data.length})</h2>
                <Button size="sm" variant="ghost" onClick={() => markSeen(notes.data!.map((n) => n.id))}>Marcar todos como vistos</Button>
              </div>
              <ul className="divide-y divide-ink-700">
                {notes.data.map((n) => (
                  <li key={n.id} className="flex items-start gap-3 px-5 py-2.5">
                    <Link to={n.link ?? '/corte'} className="min-w-0 flex-1 hover:text-brand">
                      <p className="font-medium">{n.title}</p>
                      {n.body && <p className="text-xs text-muted">{n.body}</p>}
                      <p className="text-xs text-muted">{date(n.created_at.slice(0, 10), "d 'de' MMM")} · {new Date(n.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</p>
                    </Link>
                    <Button size="sm" variant="secondary" onClick={() => markSeen([n.id])}>Visto</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {boxes.chica}{boxes.ahorro}{boxes.apartado}{boxes.chivas}{boxes.total}
          </div>
          <GaugeGrid title={`Pagos por categoría · mensualidad de ${monthNameOf(period.to.slice(0, 7) + '-01')}`} subtitle="Qué tan lleno va el cobro de la mensualidad de cada categoría">
            {data.payByCategory.map((c) => (
              <Gauge key={c.id} pct={c.pct} label={c.name} onClick={() => nav('/cobranza?f=pendiente')}
                title={`${c.paidCount} de ${c.students} alumnos ya pagaron · cobrado ${money(c.paid)} de ${money(c.due)} · faltan ${money(c.due - c.paid)}`}
                sub={<>{c.paidCount} de {c.students} pagaron<span className="block">{money(Math.round(c.paid)).replace('.00', '')} de {money(Math.round(c.due)).replace('.00', '')}</span></>} />
            ))}
          </GaugeGrid>
          <ProfeGauges month={period.to.slice(0, 7)} />
          <BreakEvenCard />
          <PeriodCards period={period} onDetail={setDetail} />
          <FundGauges />

          <div className="grid gap-6">
            <Card>
              <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
                <h2 className="font-display text-lg font-bold uppercase tracking-wide">Requieren atención</h2>
                <Link to="/cobranza?f=vencido" className="text-sm text-brand hover:underline">Ver cobranza</Link>
              </div>
              {data.overdueStudents.length === 0 && data.absent.length === 0 && data.promoAlerts.length === 0 && dueTasks.length === 0 && trials.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">Todo en orden: sin pagos vencidos ni faltas seguidas.</p>
              ) : (
                <ul className="divide-y divide-ink-700">
                  {trials.map((s) => (
                    <li key={'m' + s.id} className="flex items-center gap-3 px-5 py-3">
                      <Avatar name={s.full_name} path={s.photo_path} size={36} />
                      <Link to={`/alumnos/${s.id}`} className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.full_name}</p>
                        <p className="text-xs text-muted">Clase muestra{s.trial_on ? ` del ${date(s.trial_on, 'd MMM')}` : ''} · {catName(s.category_id ?? '')} · pendiente de cerrar registro</p>
                      </Link>
                      <Button size="sm" onClick={() => setClosing(s)}>Cerrar registro</Button>
                    </li>
                  ))}
                  {dueTasks.map(({ expense: e, inst, label }) => (
                    <li key={'i' + inst.id} className="flex items-center gap-3 px-5 py-3">
                      <div className={`rounded-full p-2 ${inst.due_date < t ? 'bg-bad/15' : 'bg-warn/15'}`}><CalendarClock className={`h-4 w-4 ${inst.due_date < t ? 'text-bad' : 'text-warn'}`} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{e.kind === 'prestamo' ? `Pagar préstamo · ${e.lender ?? e.name}` : `Pagar ${e.name}`} · {label}</p>
                        <p className="text-xs text-muted">{inst.due_date < t ? 'Atrasado · ' : ''}Toca el {date(inst.due_date, "EEEE d 'de' MMM")} · {money(inst.amount)}</p>
                      </div>
                      <Button size="sm" onClick={() => setPaying({ expense: e, inst })}>Ya se pagó</Button>
                    </li>
                  ))}
                  {data.promoAlerts.map((r) => (
                    <li key={'p' + r.g.id} className="flex items-center gap-3 pr-5">
                      <Link to="/becas" className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-5 hover:bg-ink-700/50">
                        <div className="rounded-full bg-bad/15 p-2"><AlertTriangle className="h-4 w-4 text-bad" /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{!r.valid ? 'Promo hermanos no válida' : 'Promo hermanos con pagos vencidos'} · {r.g.name}</p>
                          <p className="truncate text-xs text-muted">{!r.valid
                            ? `${r.notEnrolled.map((m) => m.full_name).join(', ')} ya no está inscrito`
                            : `${r.overdue.map((m) => m.full_name).join(', ')} con pago vencido`}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted" />
                      </Link>
                      {/* Hermanos con pago vencido: un solo mensaje a la familia con lo que deben */}
                      {r.valid && r.overdue.length > 0 && <CollectButton student={r.overdue[0]} />}
                    </li>
                  ))}
                  {byFamily(data.overdueStudents).slice(0, 6).map(({ list, total }) => {
                    const s = list[0].s
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                        <Avatar name={s.full_name} path={s.photo_path} size={36} />
                        <Link to={`/alumnos/${s.id}`} className="min-w-0 flex-1">
                          <p className="truncate font-medium">{list.length > 1 ? `Familia: ${list.map((x) => x.s.full_name.split(' ')[0]).join(' y ')}` : s.full_name}</p>
                          <p className="truncate text-xs text-muted">{list.length > 1 ? `Hermanos · ${list.map((x) => x.s.full_name).join(', ')}` : catName(s.category_id ?? '')} · Pago vencido</p>
                        </Link>
                        <span className="font-semibold text-bad">{money(total)}</span>
                        <CollectButton student={s} />
                      </li>
                    )
                  })}
                  {data.absent.slice(0, 5).map(({ s, n }) => (
                    <li key={'a' + s.id} className="flex items-center gap-3 px-5 py-3">
                      <Avatar name={s.full_name} path={s.photo_path} size={36} />
                      <Link to={`/alumnos/${s.id}`} className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.full_name}</p>
                        <p className="text-xs text-muted">{catName(s.category_id ?? '')}</p>
                      </Link>
                      <Badge tone="warn">{n} faltas seguidas</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

          </div>

          {paying && <PayInstallmentModal expense={paying.expense} inst={paying.inst} onClose={() => setPaying(null)} />}
          {closing && <CloseTrialModal student={closing} onClose={() => setClosing(null)} />}
          <CashDoubtsCard />
          <OverpaidAlert />
          <CategoryRequestsCard />
          <ProfileRequestsCard />
          <UnpaidDeliveries />
          <MatchReportsCard />
          <BirthdaysCard />
          <CoachNotes />
          <Card>
            <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
              <h2 className="font-display text-lg font-bold uppercase tracking-wide">Próximas actividades</h2>
              <Link to="/calendario" className="text-sm text-brand hover:underline">Calendario</Link>
            </div>
            {agenda.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No hay entrenamientos ni partidos programados.</p>
            ) : (
              <ul className="divide-y divide-ink-700">
                {agenda.map((a) => (
                  <li key={a.kind + a.id}>
                    <Link to={a.kind === 'ma' ? `/partidos/${a.id}` : '/entrenamientos'} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-700/50">
                      <div className={`rounded-xl p-2 ${a.kind === 'ma' ? 'bg-brand text-ink' : 'bg-ink-700 text-brand'}`}>
                        {a.kind === 'ma' ? <Trophy className="h-4 w-4" /> : <Dumbbell className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.title}</p>
                        <p className="text-xs text-muted">{catName(a.cat)} · {date(a.date, "EEE d MMM")} {time(a.time)}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ActivityFeed />
          {detail && <CardDetailModal kind={detail} onClose={() => setDetail(null)} />}
          {incomeOpen && <IncomeBreakdownModal title={`Entradas de ${mes}`} payments={payments.data ?? []} onClose={() => setIncomeOpen(false)} />}
        </div>
      )}
    </>
  )
}
