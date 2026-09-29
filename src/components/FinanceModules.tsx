import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt, ShieldCheck, UserPlus, GraduationCap } from 'lucide-react'
import { StatCard } from '@/components/ui'
import { useCoachPay, useCoaches, useExpenses, useFees, useStudents } from '@/lib/api'
import { DISCOUNT_LABEL, discountsFor, expenseEntries, insuranceSaving, isNewEnrollment } from '@/lib/finance'
import { money, today } from '@/lib/format'

const MONTH_NAME = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const monthLabel = (month: string) => `${MONTH_NAME[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

/** Gastos del mes, ahorro del seguro, nuevas inscripciones y becas/descuentos. Se usa en Dashboard y Gastos. */
export default function FinanceModules() {
  const nav = useNavigate()
  const month = today().slice(0, 7)
  const expenses = useExpenses()
  const coaches = useCoaches()
  const pay = useCoachPay()
  const students = useStudents()
  const fees = useFees()

  const d = useMemo(() => {
    const entries = expenseEntries({ month, expenses: expenses.data ?? [], coaches: coaches.data ?? [], coachPay: pay.data ?? [] })
    const salaries = entries.filter((e) => e.kind === 'sueldo').reduce((a, e) => a + e.amount, 0)
    const total = entries.reduce((a, e) => a + e.amount, 0)
    const ins = insuranceSaving(expenses.data ?? [], month)
    const nuevos = (students.data ?? []).filter((s) => s.status !== 'baja' && isNewEnrollment(s, month)).length
    const active = new Set((students.data ?? []).filter((s) => s.status === 'activo').map((s) => s.id))
    const disc = discountsFor((fees.data ?? []).filter((f) => f.period.startsWith(month) && active.has(f.student_id)))
    return { total, salaries, ins, nuevos, disc }
  }, [month, expenses.data, coaches.data, pay.data, students.data, fees.data])

  const discHint = (Object.keys(d.disc.by) as (keyof typeof d.disc.by)[])
    .filter((k) => d.disc.by[k] > 0).map((k) => `${DISCOUNT_LABEL[k]} ${money(d.disc.by[k])}`).join(' · ')

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label={`Gastos de ${MONTH_NAME[Number(month.slice(5, 7)) - 1]}`} value={money(Math.round(d.total))} icon={Receipt} tone="bad"
        hint={`Sueldos ${money(Math.round(d.salaries))} · Otros ${money(Math.round(d.total - d.salaries))} · Ver día a día`} onClick={() => nav(`/gastos/desglose?mes=${month}`)} />
      <StatCard label="Ahorro para el seguro" value={d.ins ? money(Math.round(d.ins.saved)) : '—'} icon={ShieldCheck}
        hint={!d.ins ? 'Agrega el seguro como gasto anual' : d.ins.startsIn
          ? `Empieza en ${d.ins.startsIn}: apartar ${money(Math.round(d.ins.monthly))} al mes`
          : `${d.ins.months} de 12 meses · de ${money(d.ins.total)} · se paga en ${d.ins.dueLabel}`}
        onClick={() => nav('/gastos')} />
      <StatCard label="Nuevas inscripciones" value={d.nuevos} icon={UserPlus} tone={d.nuevos ? 'ok' : undefined}
        hint={`Alumnos que entraron en ${MONTH_NAME[Number(month.slice(5, 7)) - 1]}`} onClick={() => nav(`/alumnos?nuevos=${month}&st=todos`)} />
      <StatCard label="Becas y descuentos este mes" value={money(d.disc.total)} icon={GraduationCap}
        hint={`${d.disc.students} alumnos${discHint ? ' · ' + discHint : ''}`} onClick={() => nav('/becas')} />
    </div>
  )
}
