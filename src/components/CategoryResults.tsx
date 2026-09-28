import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Info } from 'lucide-react'
import { Button, Card, Input, Spinner, cx } from './ui'
import { useCategories, useCoachCategories, useCoachPay, useCoaches, useFees, usePayments, useStudents } from '@/lib/api'
import { money, monthName, today } from '@/lib/format'
import { categoryResults } from '@/lib/finance'
import { exportCsv } from '@/lib/csv'

/** Resultado del mes por categoría: ingreso real, becas, sueldos y resultado. */
export default function CategoryResults() {
  const [month, setMonth] = useState(today().slice(0, 7))
  const categories = useCategories()
  const students = useStudents()
  const payments = usePayments()
  const fees = useFees()
  const coaches = useCoaches()
  const cc = useCoachCategories()
  const pay = useCoachPay()

  const data = useMemo(() => {
    if (!categories.data || !students.data || !payments.data || !fees.data || !coaches.data || !cc.data || !pay.data) return null
    return categoryResults({
      month, categories: categories.data, students: students.data, payments: payments.data, fees: fees.data,
      coaches: coaches.data, coachCategories: cc.data, coachPay: pay.data,
    })
  }, [month, categories.data, students.data, payments.data, fees.data, coaches.data, cc.data, pay.data])

  const doExport = () => data && exportCsv(`resultados-por-categoria-${month}.csv`,
    ['Categoría', 'Alumnos activos', 'Ingreso real', 'Becas', 'Sueldos', 'Resultado', 'Profesores'],
    [
      ...data.list.map((r) => [r.name, r.students, r.income, r.scholarships, Math.round(r.salaries), Math.round(r.result), r.coaches.join(', ')]),
      ...(data.unassignedSalaries > 0 ? [['Sueldos sin categoría', '', '', '', Math.round(data.unassignedSalaries), -Math.round(data.unassignedSalaries), data.unassignedCoaches.join(', ')]] : []),
      ['TOTAL', data.totals.students, data.totals.income, data.totals.scholarships, Math.round(data.totals.salaries), Math.round(data.totals.result), ''],
    ])

  const num = (n: number, tone?: 'ok' | 'bad' | 'muted') => (
    <span className={cx('whitespace-nowrap', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad', tone === 'muted' && 'text-muted')}>{money(Math.round(n))}</span>
  )

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-600 px-5 py-4">
        <div>
          <h3 className="font-display text-lg font-bold uppercase tracking-wide">Resultados por categoría · {monthName(month + '-01')}</h3>
          <p className="text-xs text-muted">Ingreso real − sueldos de profesores = resultado</p>
        </div>
        <div className="flex gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value || today().slice(0, 7))} className="h-9 w-40" aria-label="Mes" />
          <Button size="sm" variant="secondary" icon={Download} onClick={doExport} disabled={!data}>Exportar</Button>
        </div>
      </div>
      {!data ? <Spinner /> : (
        <>
          <div className="overflow-x-auto">
            <table className="table-base min-w-[720px]">
              <thead>
                <tr><th>Categoría</th><th>Alumnos</th><th>Ingreso real</th><th>Becas</th><th>Sueldos</th><th>Resultado</th></tr>
              </thead>
              <tbody>
                {data.list.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted">{r.coaches.length ? r.coaches.join(', ') : 'Sin profesor asignado'}</p>
                    </td>
                    <td>{r.students}</td>
                    <td>{num(r.income, 'ok')}</td>
                    <td>{r.scholarships > 0 ? num(r.scholarships, 'muted') : <span className="text-muted">—</span>}</td>
                    <td>{r.salaries > 0 ? num(-r.salaries, 'bad') : <span className="text-muted">—</span>}</td>
                    <td className="font-display text-lg font-bold">{num(r.result, r.result >= 0 ? 'ok' : 'bad')}</td>
                  </tr>
                ))}
                {data.unassignedSalaries > 0 && (
                  <tr>
                    <td><p className="font-medium">Sueldos sin categoría</p><p className="text-xs text-muted">{data.unassignedCoaches.join(', ')}</p></td>
                    <td /><td /><td />
                    <td>{num(-data.unassignedSalaries, 'bad')}</td>
                    <td className="font-display text-lg font-bold">{num(-data.unassignedSalaries, 'bad')}</td>
                  </tr>
                )}
                <tr className="bg-ink-900">
                  <td className="font-display text-lg font-bold uppercase">Total</td>
                  <td className="font-semibold">{data.totals.students}</td>
                  <td className="font-semibold">{num(data.totals.income, 'ok')}</td>
                  <td className="font-semibold">{num(data.totals.scholarships, 'muted')}</td>
                  <td className="font-semibold">{num(-data.totals.salaries, 'bad')}</td>
                  <td className="font-display text-xl font-bold">{num(data.totals.result, data.totals.result >= 0 ? 'ok' : 'bad')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="flex items-start gap-2 px-5 py-3 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Ingreso real = pagos recibidos en el mes. Las becas son lo que se dejó de cobrar (ya no está en el ingreso). Sueldo semanal × 4.33 semanas;
              si un profesor lleva varias categorías, su sueldo se reparte en partes iguales. Los sueldos se capturan en <Link to="/profesores" className="text-brand hover:underline">Profesores</Link>.
            </span>
          </p>
        </>
      )}
    </Card>
  )
}
