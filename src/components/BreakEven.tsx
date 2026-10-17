import { useMemo, useState } from 'react'
import { Scale } from 'lucide-react'
import { Card } from './ui'
import { Gauge } from './Gauges'
import { DetailModal, type Detail } from './CardDetails'
import { useCoachPay, useCoaches, useExpenses, useFees, useStudents } from '@/lib/api'
import { expenseForMonth, monthlyCost } from '@/lib/finance'
import { money, monthName, today } from '@/lib/format'

const cents = (n: number) => money(Math.round(n)).replace('.00', '')

/**
 * Punto de equilibrio: con todos los gastos del mes (administrativos, del mes y sueldos de profes)
 * y lo que en promedio paga cada niño de mensualidad, cuántos niños necesitamos para no perder.
 */
export default function BreakEvenCard() {
  const expenses = useExpenses()
  const coaches = useCoaches()
  const pay = useCoachPay()
  const fees = useFees()
  const students = useStudents()
  const [open, setOpen] = useState(false)
  const month = today().slice(0, 7)

  const d = useMemo(() => {
    const active = (students.data ?? []).filter((s) => s.status === 'activo')
    const ids = new Set(active.map((s) => s.id))
    const costs = [
      ...(expenses.data ?? []).map((e) => ({ name: e.name, monthly: expenseForMonth(e, month) })),
      ...(coaches.data ?? []).filter((c) => c.active).map((c) => ({ name: `Sueldo ${c.full_name}`, monthly: monthlyCost((pay.data ?? []).find((p) => p.coach_id === c.id)) })),
    ].filter((x) => x.monthly > 0).sort((a, b) => b.monthly - a.monthly)
    const total = costs.reduce((a, x) => a + x.monthly, 0)
    // Lo que paga en promedio un niño de mensualidad este mes (ya con becas y promociones)
    const monthFees = (fees.data ?? []).filter((f) => f.concept === 'Mensualidad' && f.period === `${month}-01` && ids.has(f.student_id))
    const avg = monthFees.length ? monthFees.reduce((a, f) => a + Number(f.total_due), 0) / monthFees.length : 0
    const needed = avg > 0 ? Math.ceil(total / avg) : 0
    return { costs, total, avg, needed, active: active.length, charged: monthFees.length }
  }, [expenses.data, coaches.data, pay.data, fees.data, students.data, month])

  if (!d.needed) return null
  const diff = d.active - d.needed
  const detail: Detail = {
    title: 'Punto de equilibrio',
    total: `${d.needed} alumnos`,
    note: `Todos los gastos del mes (${cents(d.total)}) ÷ lo que paga en promedio cada niño de mensualidad en ${monthName(`${month}-01`).split(' ')[0].toLowerCase()} (${cents(d.avg)}, ya con becas y promociones, de ${d.charged} mensualidades) = ${d.needed} alumnos. Hoy hay ${d.active} activos: ${diff >= 0 ? `sobran ${diff}` : `faltan ${-diff}`}.`,
    groups: [
      { label: 'Gastos del mes', total: d.total, rows: d.costs.map((x) => ({ label: x.name, sub: `${Math.round((x.monthly / d.total) * 100)}% del total`, value: x.monthly })) },
      { label: 'Cálculo', rows: [
        { label: 'Todos los gastos del mes', value: d.total },
        { label: '÷ Mensualidad promedio por niño', value: Math.round(d.avg * 100) / 100 },
        { label: '= Niños que se necesitan', value: `${d.needed}` },
        { label: 'Niños activos hoy', value: `${d.active}`, tone: diff >= 0 ? 'ok' : 'bad' },
      ] },
    ],
    go: { label: 'Ir a gastos', to: '/gastos' },
  }
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-5">
        <div className="w-40 shrink-0"><Gauge pct={(d.active / d.needed) * 100} label="Alumnos vs. equilibrio" onClick={() => setOpen(true)} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide"><Scale className="h-5 w-5 text-brand" /> Punto de equilibrio</h3>
          <p className="mt-1 text-lg">Necesitamos <b className="font-display text-3xl">{d.needed}</b> alumnos para cubrir todos los gastos · hoy hay <b>{d.active}</b>
            {' '}<span className={diff >= 0 ? 'font-semibold text-ok' : 'font-semibold text-bad'}>({diff >= 0 ? `sobran ${diff}` : `faltan ${-diff}`})</span></p>
          <p className="text-sm text-muted">Gastos del mes {cents(d.total)} ÷ mensualidad promedio {cents(d.avg)} · <button type="button" onClick={() => setOpen(true)} className="text-brand hover:underline">ver el cálculo</button></p>
        </div>
      </div>
      {open && <DetailModal d={detail} onClose={() => setOpen(false)} />}
    </Card>
  )
}
