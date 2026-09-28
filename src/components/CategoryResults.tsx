import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Info } from 'lucide-react'
import { Button, Card, Input, Spinner, cx } from './ui'
import { useCategories, useCoachCategories, useCoachPay, useCoaches, useExpenses, useExtraClasses, useFees, usePayments, useStudents } from '@/lib/api'
import { money, monthName, today } from '@/lib/format'
import { categoryResults } from '@/lib/finance'
import { exportCsv } from '@/lib/csv'

/**
 * Ganancia real por categoría del mes:
 * ingreso real − gastos generales (proporcionales a sus alumnos) − sueldo del profe.
 * Además muestra lo que no se recibió por becas.
 */
export default function CategoryResults() {
  const [month, setMonth] = useState(today().slice(0, 7))
  const categories = useCategories()
  const students = useStudents()
  const payments = usePayments()
  const fees = useFees()
  const coaches = useCoaches()
  const cc = useCoachCategories()
  const pay = useCoachPay()
  const expenses = useExpenses()
  const extras = useExtraClasses()

  const data = useMemo(() => {
    if (!categories.data || !students.data || !payments.data || !fees.data || !coaches.data || !cc.data || !pay.data || !expenses.data) return null
    return categoryResults({
      month, categories: categories.data, students: students.data, payments: payments.data, fees: fees.data,
      coaches: coaches.data, coachCategories: cc.data, coachPay: pay.data, expenses: expenses.data, extraClasses: extras.data ?? [],
    })
  }, [month, categories.data, students.data, payments.data, fees.data, coaches.data, cc.data, pay.data, expenses.data, extras.data])

  const r0 = (n: number) => Math.round(n)
  const doExport = () => data && exportCsv(`ganancia-por-categoria-${month}.csv`,
    ['Categoría', 'Profesor', 'Sueldo del profe (mes)', 'Alumnos activos', 'Ingreso real', 'No recibido por becas', 'Gastos generales', 'Sueldo del profe', 'Ganancia real'],
    [
      ...data.list.map((r) => [r.name, r.coaches.map((c) => c.name).join(', '), r0(r.coaches.reduce((a, c) => a + c.monthly, 0)), r.students, r.income, r.scholarships, r0(r.generalExpenses), r0(r.salaries), r0(r.result)]),
      ['TOTAL', '', '', data.totals.students, data.totals.income, data.totals.scholarships, r0(data.totals.generalExpenses), r0(data.totals.salaries), r0(data.totals.result)],
    ])

  const num = (n: number, tone?: 'ok' | 'bad' | 'muted' | 'warn') => (
    <span className={cx('whitespace-nowrap', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad', tone === 'muted' && 'text-muted', tone === 'warn' && 'text-warn')}>{money(r0(n))}</span>
  )

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-600 px-5 py-4">
        <div>
          <h3 className="font-display text-lg font-bold uppercase tracking-wide">Ganancia real por categoría · {monthName(month + '-01')}</h3>
          <p className="text-xs text-muted">Ingreso real − gastos generales (según sus alumnos) − sueldo del profe</p>
        </div>
        <div className="flex gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value || today().slice(0, 7))} className="h-9 w-40" aria-label="Mes" />
          <Button size="sm" variant="secondary" icon={Download} onClick={doExport} disabled={!data}>Exportar</Button>
        </div>
      </div>
      {!data ? <Spinner /> : (
        <>
          <div className="overflow-x-auto">
            <table className="table-base min-w-[980px]">
              <thead>
                <tr>
                  <th>Categoría y profesor</th><th>Alumnos</th><th>Ingreso real</th><th>No recibido (becas)</th>
                  <th>Gastos generales</th><th>Sueldo del profe</th><th>Ganancia real</th>
                </tr>
              </thead>
              <tbody>
                {data.list.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <p className="font-medium">{r.name}{categories.data?.find((c) => c.id === r.id)?.is_extra && <span className="ml-2 rounded bg-info/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-info">Clase extra</span>}</p>
                      {r.coaches.length ? r.coaches.map((c) => (
                        <p key={c.name} className="text-xs text-muted">
                          {c.name} · {money(r0(c.monthly))}/mes{c.share > 1 && ` (entre ${c.share} categorías)`}
                        </p>
                      )) : <Link to="/profesores" className="text-xs text-warn hover:underline">Sin profesor asignado</Link>}
                    </td>
                    <td>{r.students}</td>
                    <td>{num(r.income, 'ok')}</td>
                    <td>{r.scholarships > 0 ? num(r.scholarships, 'warn') : <span className="text-muted">—</span>}</td>
                    <td>{categories.data?.find((c) => c.id === r.id)?.is_extra
                      ? <span className="text-xs text-muted">No aplica<span className="block">(ya cuentan en su categoría)</span></span>
                      : <>{num(-r.generalExpenses, 'bad')}<span className="block text-xs text-muted">{r.students} × {money(Math.round(data.perStudent * 100) / 100)}</span></>}</td>
                    <td>{r.salaries > 0 ? num(-r.salaries, 'bad') : <span className="text-muted">—</span>}</td>
                    <td className="font-display text-lg font-bold">{num(r.result, r.result >= 0 ? 'ok' : 'bad')}</td>
                  </tr>
                ))}
                <tr className="bg-ink-900">
                  <td className="font-display text-lg font-bold uppercase">Total academia</td>
                  <td className="font-semibold">{data.totals.students}</td>
                  <td className="font-semibold">{num(data.totals.income, 'ok')}</td>
                  <td className="font-semibold">{num(data.totals.scholarships, 'warn')}</td>
                  <td className="font-semibold">{num(-data.totals.generalExpenses, 'bad')}</td>
                  <td className="font-semibold">{num(-data.totals.salaries, 'bad')}</td>
                  <td className="font-display text-xl font-bold">{num(data.totals.result, data.totals.result >= 0 ? 'ok' : 'bad')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="space-y-1 px-5 py-3 text-xs text-muted">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b className="text-white">Ingreso real</b>: pagos recibidos en el mes. <b className="text-white">No recibido (becas)</b>: dinero que se dejó de cobrar por becas; ya no está en el ingreso, por eso no se resta otra vez.
                {' '}<b className="text-white">Gastos generales</b>: todo lo de <Link to="/gastos" className="text-brand hover:underline">Gastos</Link> ({money(r0(data.generalTotal))} al mes ÷ {data.activeTotal} alumnos = {money(Math.round(data.perStudent * 100) / 100)} por alumno) × alumnos de la categoría.
              </span>
            </p>
            {data.unassignedCoaches.length > 0 && (
              <p className="pl-5 text-warn">Sueldos de profesores sin categoría ({data.unassignedCoaches.join(', ')}) se reparten entre todos como gasto general. Asígnales su categoría en <Link to="/profesores" className="underline">Profesores</Link>.</p>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
