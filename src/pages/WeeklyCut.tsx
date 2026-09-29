import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Scale, Banknote, Download, MessageCircle, Printer } from 'lucide-react'
import { Badge, Button, Card, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui'
import { useCoachPay, useCoaches, useExpenses, useFees, usePayments, useStudents } from '@/lib/api'
import { expenseEntries } from '@/lib/finance'
import { METHOD_LABEL, date, money, monthName, toISODate, today } from '@/lib/format'
import { exportCsv } from '@/lib/csv'
import type { PaymentMethod } from '@/lib/types'

const cents = (n: number) => money(Math.round(n * 100) / 100)
const mondayOf = (d: string) => toISODate(startOfWeek(new Date(d + 'T12:00:00'), { weekStartsOn: 1 }))
const shift = (d: string, days: number) => toISODate(addDays(new Date(d + 'T12:00:00'), days))

/** Corte de la semana (lunes a domingo): lo que entró, lo que salió y lo que queda. */
export default function WeeklyCut() {
  const [params, setParams] = useSearchParams()
  const from = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(params.get('semana') ?? '') ? params.get('semana')! : today())
  const to = shift(from, 6)
  const setWeek = (d: string) => setParams({ semana: d }, { replace: true })

  const payments = usePayments(undefined, from)
  const fees = useFees()
  const students = useStudents()
  const expenses = useExpenses()
  const coaches = useCoaches()
  const pay = useCoachPay()

  const d = useMemo(() => {
    const feeMap = new Map((fees.data ?? []).map((f) => [f.id, f]))
    const nameMap = new Map((students.data ?? []).map((s) => [s.id, s.full_name]))
    const ins = (payments.data ?? []).filter((p) => p.paid_at.slice(0, 10) >= from && p.paid_at.slice(0, 10) <= to)
      .map((p) => {
        const f = feeMap.get(p.fee_id)
        return { ...p, day: p.paid_at.slice(0, 10), student: nameMap.get(p.student_id) ?? '—', concept: f ? `${f.concept} ${monthName(f.period)}` : 'Pago', kind: f?.concept ?? 'Otro' }
      }).sort((a, b) => a.day.localeCompare(b.day) || a.student.localeCompare(b.student))
    const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])]
    const outs = months.flatMap((month) => expenseEntries({ month, expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: pay.data ?? [] }))
      .filter((e) => e.date >= from && e.date <= to)
    const inTotal = ins.reduce((a, p) => a + Number(p.amount), 0)
    const outTotal = outs.reduce((a, e) => a + e.amount, 0)
    const byMethod = new Map<PaymentMethod, { n: number; total: number }>()
    for (const p of ins) { const r = byMethod.get(p.method) ?? { n: 0, total: 0 }; r.n++; r.total += Number(p.amount); byMethod.set(p.method, r) }
    const byKind = new Map<string, { n: number; total: number }>()
    for (const p of ins) { const r = byKind.get(p.kind) ?? { n: 0, total: 0 }; r.n++; r.total += Number(p.amount); byKind.set(p.kind, r) }
    return { ins, outs, inTotal, outTotal, net: inTotal - outTotal, cash: byMethod.get('efectivo')?.total ?? 0, byMethod: [...byMethod.entries()], byKind: [...byKind.entries()].sort((a, b) => b[1].total - a[1].total) }
  }, [payments.data, fees.data, students.data, expenses.data, coaches.data, pay.data, from, to])

  const label = `${date(from, "d 'de' MMM")} al ${date(to, "d 'de' MMM yyyy")}`
  const summary = [
    `*Corte semanal Rancho Seco*`, `Semana del ${label}`, '',
    `Entró: ${cents(d.inTotal)} (${d.ins.length} pagos)`,
    ...d.byMethod.map(([m, r]) => `  · ${METHOD_LABEL[m]}: ${cents(r.total)}`),
    `Salió: ${cents(d.outTotal)}`,
    `*Queda: ${cents(d.net)}*`,
  ].join('\n')
  const doExport = () => exportCsv(`corte-semana-${from}.csv`, ['Tipo', 'Fecha', 'Concepto', 'Alumno / detalle', 'Forma de pago', 'Monto'], [
    ...d.ins.map((p) => ['Entrada', p.day, p.concept, p.student, METHOD_LABEL[p.method], Number(p.amount)]),
    ...d.outs.map((e) => ['Salida', e.date, e.name, e.detail, '', -e.amount]),
    ['TOTAL', '', '', '', '', d.net],
  ])

  const error = payments.error || fees.error || expenses.error
  if (error) return <ErrorState error={error} onRetry={() => payments.refetch()} />
  const loading = payments.isLoading || fees.isLoading || students.isLoading || expenses.isLoading || coaches.isLoading

  return (
    <>
      <PageHeader title="Corte semanal" subtitle={`Semana del ${label} (lunes a domingo)`}
        actions={<>
          <Button variant="secondary" icon={Download} onClick={doExport} disabled={loading}>Exportar</Button>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()} className="hidden sm:inline-flex">Imprimir</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(summary)}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-wa px-4 text-sm font-semibold text-ink hover:brightness-110"><MessageCircle className="h-4 w-4" /> Enviar corte</a>
        </>} />

      <div className="mb-5 flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" icon={ChevronLeft} onClick={() => setWeek(shift(from, -7))}>Semana anterior</Button>
        {from !== mondayOf(today()) && <Button variant="ghost" size="sm" onClick={() => setWeek(today())}>Esta semana</Button>}
        <Button variant="secondary" size="sm" onClick={() => setWeek(shift(from, 7))}>Semana siguiente <ChevronRight className="h-4 w-4" /></Button>
      </div>

      {loading ? <Spinner /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Entró" value={cents(d.inTotal)} icon={TrendingUp} tone="ok" hint={`${d.ins.length} pagos registrados`} />
            <StatCard label="Salió" value={cents(d.outTotal)} icon={TrendingDown} tone="bad" hint="Sueldos y gastos de la semana" />
            <StatCard label="Queda" value={cents(d.net)} icon={Scale} tone={d.net >= 0 ? 'ok' : 'bad'} hint="Entró − salió" />
            <StatCard label="Efectivo cobrado" value={cents(d.cash)} icon={Banknote} tone="brand" hint="Lo que debe haber en caja por cobros" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Entradas por forma de pago</h3>
              <table className="table-base">
                <tbody>
                  {d.byMethod.length === 0 ? <tr><td className="py-6 text-center text-muted">Sin pagos esta semana.</td></tr> :
                    d.byMethod.map(([m, r]) => <tr key={m}><td className="font-medium">{METHOD_LABEL[m]}</td><td className="text-muted">{r.n} pagos</td><td className="text-right font-semibold">{cents(r.total)}</td></tr>)}
                </tbody>
              </table>
            </Card>
            <Card>
              <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Entradas por concepto</h3>
              <table className="table-base">
                <tbody>
                  {d.byKind.length === 0 ? <tr><td className="py-6 text-center text-muted">Sin pagos esta semana.</td></tr> :
                    d.byKind.map(([k, r]) => <tr key={k}><td className="font-medium">{k}</td><td className="text-muted">{r.n} pagos</td><td className="text-right font-semibold">{cents(r.total)}</td></tr>)}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="overflow-x-auto">
            <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Pagos recibidos ({d.ins.length})</h3>
            <table className="table-base min-w-[620px]">
              <thead><tr><th>Fecha</th><th>Alumno</th><th>Concepto</th><th>Forma de pago</th><th className="text-right">Monto</th></tr></thead>
              <tbody>
                {d.ins.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-muted">Sin pagos esta semana.</td></tr> : d.ins.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{date(p.day, 'EEE d MMM')}</td>
                    <td><Link to={`/alumnos/${p.student_id}?tab=pagos`} className="hover:text-brand">{p.student}</Link></td>
                    <td className="text-sm text-muted">{p.concept}</td>
                    <td>{METHOD_LABEL[p.method]}</td>
                    <td className="text-right font-semibold">{cents(Number(p.amount))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-ink-900"><td colSpan={4} className="font-display text-lg font-bold uppercase">Total entradas</td><td className="text-right font-display text-lg font-bold text-ok">{cents(d.inTotal)}</td></tr></tfoot>
            </table>
          </Card>

          <Card className="overflow-x-auto">
            <h3 className="border-b border-ink-600 px-5 py-4 font-display text-lg font-bold uppercase tracking-wide">Gastos y sueldos de la semana</h3>
            <table className="table-base min-w-[520px]">
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th className="text-right">Monto</th></tr></thead>
              <tbody>
                {d.outs.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-muted">Sin gastos esta semana.</td></tr> : d.outs.map((e, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{date(e.date, 'EEE d MMM')}</td>
                    <td className="font-medium">{e.name}</td>
                    <td><Badge tone={e.kind === 'sueldo' ? 'brand' : e.kind === 'mes' ? 'warn' : 'neutral'}>{e.detail}</Badge></td>
                    <td className="text-right font-semibold">{cents(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-ink-900"><td colSpan={3} className="font-display text-lg font-bold uppercase">Total salidas</td><td className="text-right font-display text-lg font-bold text-bad">{cents(d.outTotal)}</td></tr></tfoot>
            </table>
            <p className="px-5 py-3 text-xs text-muted">Sueldos semanales cada sábado · gastos mensuales el día 1 · gastos del mes en su fecha. Se editan en <Link to="/gastos" className="text-brand hover:underline">Gastos</Link>.</p>
          </Card>
        </div>
      )}
    </>
  )
}
