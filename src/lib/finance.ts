import type { Category, CoachPay, FeeBalance, Payment } from './types'

export const FREQUENCY_LABEL: Record<CoachPay['frequency'], string> = {
  semanal: 'por semana',
  quincenal: 'por quincena',
  mensual: 'por mes',
}

/** Costo mensual de un sueldo según su frecuencia (semanal = 52 semanas / 12 meses). */
export function monthlyCost(pay: Pick<CoachPay, 'amount' | 'frequency'> | undefined | null) {
  if (!pay) return 0
  const a = Number(pay.amount)
  return pay.frequency === 'semanal' ? (a * 52) / 12 : pay.frequency === 'quincenal' ? a * 2 : a
}

export interface CategoryResult {
  id: string
  name: string
  students: number
  income: number
  scholarships: number
  salaries: number
  result: number
  coaches: string[]
}

/**
 * Resultado del mes por categoría:
 *   ingreso real (pagos recibidos en el mes de alumnos de la categoría)
 *   becas (descuentos de los cargos de ese mes)
 *   sueldos (costo mensual del profesor, repartido entre sus categorías)
 *   resultado = ingreso real − sueldos
 */
export function categoryResults(opts: {
  month: string // 'YYYY-MM'
  categories: Category[]
  students: { id: string; category_id: string | null; status: string }[]
  payments: Payment[]
  fees: FeeBalance[]
  coaches: { id: string; full_name: string; active: boolean }[]
  coachCategories: { coach_id: string; category_id: string }[]
  coachPay: CoachPay[]
}) {
  const { month, categories, students, payments, fees, coaches, coachCategories, coachPay } = opts
  const catOf = new Map(students.map((s) => [s.id, s.category_id]))
  const rows = new Map<string, CategoryResult>(
    categories.map((c) => [c.id, { id: c.id, name: c.name, students: 0, income: 0, scholarships: 0, salaries: 0, result: 0, coaches: [] }]),
  )
  for (const s of students) if (s.status === 'activo' && s.category_id) rows.get(s.category_id) && rows.get(s.category_id)!.students++
  let unassignedIncome = 0
  for (const p of payments) {
    if (!p.paid_at.startsWith(month)) continue
    const r = rows.get(catOf.get(p.student_id) ?? '')
    if (r) r.income += Number(p.amount)
    else unassignedIncome += Number(p.amount)
  }
  for (const f of fees) {
    if (!f.period.startsWith(month)) continue
    const r = rows.get(catOf.get(f.student_id) ?? '')
    if (r) r.scholarships += Number(f.discount)
  }
  let unassignedSalaries = 0
  const unassignedCoaches: string[] = []
  for (const c of coaches) {
    if (!c.active) continue
    const cost = monthlyCost(coachPay.find((p) => p.coach_id === c.id))
    const cats = coachCategories.filter((x) => x.coach_id === c.id && rows.has(x.category_id))
    if (!cats.length) {
      if (cost > 0) { unassignedSalaries += cost; unassignedCoaches.push(c.full_name) }
      continue
    }
    for (const x of cats) {
      const r = rows.get(x.category_id)!
      r.salaries += cost / cats.length
      r.coaches.push(cats.length > 1 ? `${c.full_name} (1/${cats.length})` : c.full_name)
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, result: r.income - r.salaries }))
  const sum = (k: 'students' | 'income' | 'scholarships' | 'salaries') => list.reduce((a, r) => a + r[k], 0)
  const totals = {
    students: sum('students'),
    income: sum('income') + unassignedIncome,
    scholarships: sum('scholarships'),
    salaries: sum('salaries') + unassignedSalaries,
  }
  return {
    list,
    unassignedIncome,
    unassignedSalaries,
    unassignedCoaches,
    totals: { ...totals, result: totals.income - totals.salaries },
  }
}
