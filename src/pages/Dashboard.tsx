import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { startOfMonth } from 'date-fns'
import { Users, UserCog, ClipboardCheck, AlertTriangle, Wallet, TrendingUp, Plus, ChevronRight, Trophy, Dumbbell, HelpCircle } from 'lucide-react'
import { Avatar, Button, Card, ErrorState, PageHeader, Spinner, StatCard, Badge } from '@/components/ui'
import { CollectButton } from '@/components/WhatsAppButtons'
import FinanceModules from '@/components/FinanceModules'
import { useAccounts, useCategories, useCoaches, useFees, useMatches, usePayments, useSiblingGroups, useExtraClasses, useStudents, useTrainings, useAttendanceDetail } from '@/lib/api'
import { promoStatus } from '@/lib/siblings'
import { date, money, time, toISODate, today } from '@/lib/format'
import { consecutiveAbsences } from '@/lib/stats'

export default function Dashboard() {
  const nav = useNavigate()
  const monthStart = toISODate(startOfMonth(new Date()))
  const t = today()
  const students = useStudents()
  const coaches = useCoaches()
  const categories = useCategories()
  const accounts = useAccounts()
  const fees = useFees()
  const payments = usePayments(undefined, monthStart)
  const upcomingTr = useTrainings({ from: t })
  const upcomingMa = useMatches({ from: t })
  const siblingGroups = useSiblingGroups()
  const extraClasses = useExtraClasses()
  const recentAtt = useAttendanceDetail({ from: toISODate(new Date(Date.now() - 60 * 86400_000)) })

  const data = useMemo(() => {
    const active = (students.data ?? []).filter((s) => s.status === 'activo')
    const activeIds = new Set(active.map((s) => s.id))
    const extraMembers = (id: string) => new Set((extraClasses.data ?? []).filter((x) => x.category_id === id).map((x) => x.student_id))
    const byCategory = (categories.data ?? []).map((c) => ({ ...c, count: c.is_extra ? active.filter((s) => extraMembers(c.id).has(s.id)).length : active.filter((s) => s.category_id === c.id).length }))
    const noCat = active.filter((s) => !s.category_id).length
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
    return { promoAlerts, active, byCategory, noCat, todayAtt, present, openFees, pendingTotal, lateFees, extras, reviewTotal, collected, overdueStudents, absent }
  }, [students.data, categories.data, recentAtt.data, fees.data, payments.data, accounts.data, t, monthStart, siblingGroups.data, extraClasses.data])

  const loading = students.isLoading || accounts.isLoading || fees.isLoading
  const error = students.error || accounts.error || fees.error || categories.error
  if (error) return <><PageHeader title="Dashboard" /><ErrorState error={error} onRetry={() => { students.refetch(); accounts.refetch(); fees.refetch(); categories.refetch() }} /></>

  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.count))
  const agenda = [
    ...(upcomingTr.data ?? []).map((x) => ({ kind: 'tr' as const, date: x.date, time: x.start_time, cat: x.category_id, title: x.objectives || 'Entrenamiento', id: x.id })),
    ...(upcomingMa.data ?? []).filter((m) => m.status === 'programado').map((x) => ({ kind: 'ma' as const, date: x.date, time: x.time, cat: x.category_id, title: `vs ${x.opponent}`, id: x.id })),
  ].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? ''))).slice(0, 6)
  const catName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? ''

  return (
    <>
      <PageHeader title="Dashboard" subtitle={date(t, "EEEE d 'de' MMMM")}
        actions={<>
          <Button icon={ClipboardCheck} onClick={() => nav('/asistencias')}>Pasar lista</Button>
          <Button variant="secondary" icon={Wallet} onClick={() => nav('/cobranza')}>Registrar pago</Button>
          <Button variant="secondary" icon={Plus} onClick={() => nav('/alumnos?nuevo=1')} className="hidden sm:inline-flex">Nuevo alumno</Button>
        </>} />

      {loading ? <Spinner /> : (
        <div className="space-y-6">
          <FinanceModules />
          <div className="!mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Cobrado este mes" value={money(data.collected)} icon={TrendingUp} tone="ok" onClick={() => nav('/cobranza')} />
            <StatCard label="Pendiente de cobro" value={money(data.pendingTotal)} icon={Wallet} hint={`${data.openFees.length} cargos abiertos · ${data.overdueStudents.length} alumnos atrasados`} onClick={() => nav('/cobranza?f=pendiente')} />
            <StatCard label="Recargos y extras pendientes" value={money(data.lateFees + data.extras)} icon={AlertTriangle} tone={data.lateFees + data.extras > 0 ? 'bad' : undefined}
              hint={`Recargos ${money(data.lateFees)} · Extras ${money(data.extras)}`} onClick={() => nav('/cobranza?f=vencido')} />
            <StatCard label="Asistencia de hoy" value={data.todayAtt.length ? `${data.present}/${data.todayAtt.length}` : '—'} icon={ClipboardCheck} hint={data.todayAtt.length ? 'presentes' : 'Aún no se pasa lista'} onClick={() => nav('/asistencias')} />
            <StatCard label="Alumnos activos" value={data.active.length} icon={Users} onClick={() => nav('/alumnos')} />
            <StatCard label="Profesores" value={(coaches.data ?? []).filter((c) => c.active).length} icon={UserCog} onClick={() => nav('/profesores')} />
            <StatCard label="¿Beca? Por confirmar" value={money(data.reviewTotal)} icon={HelpCircle} hint={`${data.openFees.filter((f) => f.status === 'por_confirmar').length} pagos menores a la cuota`} onClick={() => nav('/cobranza?f=por_confirmar')} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
                <h2 className="font-display text-lg font-bold uppercase tracking-wide">Requieren atención</h2>
                <Link to="/cobranza?f=vencido" className="text-sm text-brand hover:underline">Ver cobranza</Link>
              </div>
              {data.overdueStudents.length === 0 && data.absent.length === 0 && data.promoAlerts.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">Todo en orden: sin pagos vencidos ni faltas seguidas.</p>
              ) : (
                <ul className="divide-y divide-ink-700">
                  {data.promoAlerts.map((r) => (
                    <li key={'p' + r.g.id}>
                      <Link to="/becas" className="flex items-center gap-3 px-5 py-3 hover:bg-ink-700/50">
                        <div className="rounded-full bg-bad/15 p-2"><AlertTriangle className="h-4 w-4 text-bad" /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{!r.valid ? 'Promo hermanos no válida' : 'Promo hermanos con pagos vencidos'} · {r.g.name}</p>
                          <p className="truncate text-xs text-muted">{!r.valid
                            ? `${r.notEnrolled.map((m) => m.full_name).join(', ')} ya no está inscrito`
                            : `${r.overdue.map((m) => m.full_name).join(', ')} con pago vencido`}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted" />
                      </Link>
                    </li>
                  ))}
                  {data.overdueStudents.slice(0, 6).map(({ acc, s }) => (
                    <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                      <Avatar name={s.full_name} path={s.photo_path} size={36} />
                      <Link to={`/alumnos/${s.id}`} className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.full_name}</p>
                        <p className="text-xs text-muted">{catName(s.category_id ?? '')} · Pago vencido</p>
                      </Link>
                      <span className="font-semibold text-bad">{money(acc.balance)}</span>
                      <CollectButton student={s} />
                    </li>
                  ))}
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

            <Card>
              <div className="border-b border-ink-600 px-5 py-4">
                <h2 className="font-display text-lg font-bold uppercase tracking-wide">Alumnos por categoría</h2>
              </div>
              <ul className="space-y-3 px-5 py-4">
                {data.byCategory.map((c) => (
                  <li key={c.id}>
                    <Link to={`/alumnos?cat=${c.id}`} className="group block">
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="group-hover:text-brand">{c.name}</span>
                        <span className="font-semibold">{c.count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-ink-700">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${(c.count / maxCat) * 100}%` }} />
                      </div>
                    </Link>
                  </li>
                ))}
                {data.noCat > 0 && <li className="text-sm text-muted">Sin categoría: {data.noCat}</li>}
              </ul>
            </Card>
          </div>

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
        </div>
      )}
    </>
  )
}
