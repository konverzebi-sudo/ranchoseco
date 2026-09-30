import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, UserCog, Receipt, CalendarDays } from 'lucide-react'
import { Badge, Card, ErrorState, Input, PageHeader, Spinner, StatCard, cx } from '@/components/ui'
import { monthLabel } from '@/components/FinanceModules'
import { useCoachPay, useCoaches, useExpenses } from '@/lib/api'
import { expenseEntries, type ExpenseEntry } from '@/lib/finance'
import { date, money, today } from '@/lib/format'

const KIND: Record<ExpenseEntry['kind'], { label: string; tone: 'brand' | 'warn' | 'neutral' }> = {
  sueldo: { label: 'Sueldo', tone: 'brand' },
  fijo: { label: 'Fijo', tone: 'neutral' },
  mes: { label: 'Del mes', tone: 'warn' },
  prestamo: { label: 'Préstamo', tone: 'warn' },
}
const cents = (n: number) => money(Math.round(n * 100) / 100)

/** Desglose de los gastos de un mes, día por día. */
export default function ExpenseBreakdown() {
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : today().slice(0, 7)
  const expenses = useExpenses()
  const coaches = useCoaches()
  const pay = useCoachPay()

  const { days, total, salaries, fixed, extra } = useMemo(() => {
    const entries = expenseEntries({ month, expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: pay.data ?? [] })
    const byDay = new Map<string, ExpenseEntry[]>()
    for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
    const sum = (k?: ExpenseEntry['kind']) => entries.filter((e) => !k || e.kind === k).reduce((a, e) => a + e.amount, 0)
    return { days: [...byDay.entries()], total: sum(), salaries: sum('sueldo'), fixed: sum('fijo'), extra: sum('mes') }
  }, [month, expenses.data, coaches.data, pay.data])

  const t = today()
  let running = 0
  if (expenses.error) return <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} />
  return (
    <>
      <PageHeader title="Gastos día a día" subtitle={`Todo lo que sale en ${monthLabel(month)}: sueldos, gastos fijos y gastos del mes.`}
        actions={<>
          <Link to="/gastos" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-700 px-4 text-sm font-semibold hover:bg-ink-600"><ArrowLeft className="h-4 w-4" /> Gastos</Link>
          <Input type="month" value={month} onChange={(e) => e.target.value && setParams({ mes: e.target.value }, { replace: true })} className="h-10 w-44" aria-label="Mes" />
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total del mes" value={money(Math.round(total))} icon={CalendarDays} tone="bad" />
        <StatCard label="Sueldos de profesores" value={money(Math.round(salaries))} icon={UserCog} hint="Semanales cada miércoles" />
        <StatCard label="Gastos fijos y staff" value={money(Math.round(fixed))} icon={Receipt} hint="Mensuales el día 1 · anuales en su mes" />
        <StatCard label="Gastos del mes" value={money(Math.round(extra))} icon={Receipt} hint="En la fecha en que se capturaron" />
      </div>

      {expenses.isLoading || coaches.isLoading ? <Spinner /> : days.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No hay gastos en {monthLabel(month)}.</Card>
      ) : (
        <div className="space-y-3">
          {days.map(([d, items]) => {
            const dayTotal = items.reduce((a, e) => a + e.amount, 0)
            running += dayTotal
            return (
              <Card key={d} className={cx('overflow-hidden', d > t && 'opacity-70')}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 bg-ink-900 px-4 py-2.5">
                  <p className="font-display text-lg font-bold uppercase tracking-wide">{date(d, "EEEE d 'de' MMMM")}{d > t && <span className="ml-2 text-xs font-normal normal-case text-muted">(programado)</span>}</p>
                  <p className="text-sm"><b className="text-bad">{cents(dayTotal)}</b> <span className="text-muted">· acumulado {money(Math.round(running))}</span></p>
                </div>
                <ul className="divide-y divide-ink-700">
                  {items.map((e, i) => (
                    <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <Badge tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{e.name}</p>
                        <p className="text-xs text-muted">{e.detail}</p>
                      </div>
                      <span className="font-semibold">{cents(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })}
          <Card className="flex items-center justify-between bg-ink-900 px-5 py-4">
            <p className="font-display text-lg font-bold uppercase">Total {monthLabel(month)}</p>
            <p className="font-display text-3xl font-bold text-bad">{money(Math.round(total))}</p>
          </Card>
        </div>
      )}
    </>
  )
}
