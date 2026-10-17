import { useMemo, useState } from 'react'
import { Input } from './ui'
import { Gauge, GaugeGrid } from './Gauges'
import { useCategoryResults } from './CategoryResults'
import { useCashCuts, useExpenses, useExtraClasses, useFees, useStudents } from '@/lib/api'
import { savingFunds } from '@/lib/cashcut'
import { date, money, monthName, today } from '@/lib/format'

export interface FundBar { name: string; saved: number; target: number; hint?: string }

const cents = (n: number) => money(Math.round(n)).replace('.00', '')
const mesDe = (month: string) => monthName(`${month}-01`).split(' ')[0].toLowerCase()

/** Barras de los fondos: regalías, renta, seguro y uniformes. */
export function fundBars(funds: ReturnType<typeof savingFunds>, now: (key: string) => number = () => 0): FundBar[] {
  const fondo = (re: RegExp) => funds.filter((f) => re.test(f.name) && f.target > 0)
    .map((f) => ({ name: f.name, saved: f.saved + now(f.key), target: f.target, hint: `Para el ${date(f.due, "d 'de' MMM")}` }))
  const unif = funds.filter((f) => f.kind === 'uniformes').reduce((a, f) => a + f.saved + now(f.key), 0)
  return [...fondo(/regal/i), ...fondo(/renta/i), ...fondo(/seguro/i), { name: 'Uniformes', saved: unif, target: 0, hint: 'Lo guardado (sin meta)' }]
}

/** Fondos (regalías, renta, seguro, uniformes) en medidores tipo gasolina. */
export function FundGauges({ funds: given }: { funds?: FundBar[] }) {
  const cuts = useCashCuts()
  const expenses = useExpenses()
  const funds = useMemo(() => given ?? fundBars(savingFunds({ cutDate: today(), expenses: expenses.data ?? [], cuts: cuts.data ?? [] })), [given, cuts.data, expenses.data])
  return (
    <GaugeGrid title="¿Cuánto llevamos juntado en los fondos?" subtitle="Verde = completo · amarillo = más de la mitad · rojo = va atrás">
      {funds.map((f) => (
        <Gauge key={f.name} pct={f.target > 0 ? (f.saved / f.target) * 100 : null} label={f.name}
          sub={<>{cents(f.saved)}{f.target > 0 ? ` de ${cents(f.target)}` : ''}{f.hint ? <span className="block">{f.hint}</span> : null}</>} />
      ))}
    </GaugeGrid>
  )
}

/**
 * Sueldo de cada profe cubierto con lo que ya se cobró de la MENSUALIDAD del mes de los niños
 * de sus categorías (igual que "Pagos por categoría"). Un niño en clase extra (Porteros) reparte
 * su mensualidad entre su categoría y la clase extra; si la categoría tiene varios profes, se reparte.
 */
export function ProfeGauges({ month, picker }: { month: string; picker?: React.ReactNode }) {
  const { data } = useCategoryResults(month)
  const fees = useFees()
  const students = useStudents()
  const extras = useExtraClasses()
  const income = useMemo(() => {
    const base = new Map((students.data ?? []).map((s) => [s.id, s.category_id]))
    const ext = new Map<string, string[]>()
    for (const x of extras.data ?? []) ext.set(x.student_id, [...(ext.get(x.student_id) ?? []), x.category_id])
    const m = new Map<string, number>()
    for (const f of fees.data ?? []) {
      if (f.concept !== 'Mensualidad' || f.period !== `${month}-01`) continue
      const cats = [base.get(f.student_id), ...(ext.get(f.student_id) ?? [])].filter(Boolean) as string[]
      const paid = Math.min(Number(f.paid), Number(f.total_due))
      for (const c of cats) m.set(c, (m.get(c) ?? 0) + paid / cats.length)
    }
    return m
  }, [fees.data, students.data, extras.data, month])
  const profes = useMemo(() => {
    const m = new Map<string, FundBar>()
    for (const r of data?.list ?? []) {
      for (const c of r.coaches) {
        const part = c.monthly / c.share
        const covered = r.salaries > 0 ? ((income.get(r.id) ?? 0) * part) / r.salaries : 0
        const x = m.get(c.name) ?? { name: c.name, saved: 0, target: c.monthly, hint: '' }
        x.saved += covered
        x.hint = [x.hint, r.name].filter(Boolean).join(' · ')
        m.set(c.name, x)
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [data, income])
  return (
    <GaugeGrid title={`Sueldo de cada profe · ${mesDe(month)}`} actions={picker}
      subtitle="¿Ya alcanza la mensualidad que pagaron sus niños para su sueldo del mes?">
      {profes.length ? profes.map((f) => (
        <Gauge key={f.name} pct={(f.saved / f.target) * 100} label={f.name}
          title={`Mensualidad cobrada de ${f.hint}: ${cents(f.saved)} · sueldo del mes ${cents(f.target)}`}
          sub={<>{cents(f.saved)} de {cents(f.target)}<span className="block">{f.hint}</span></>} />
      )) : <p className="col-span-full text-sm text-muted">Cargando…</p>}
    </GaugeGrid>
  )
}

/** Fondos y sueldos de profes (se usa en el corte de caja, con su propio mes). */
export default function FundProgress({ funds, month: initial }: { funds?: FundBar[]; month?: string }) {
  const [month, setMonth] = useState(initial ?? today().slice(0, 7))
  return (
    <div className="space-y-3">
      <FundGauges funds={funds} />
      <ProfeGauges month={month} picker={<Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-10 w-44" aria-label="Mes" />} />
    </div>
  )
}
