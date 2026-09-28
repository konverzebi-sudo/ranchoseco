import type { Category, CoachPay, Expense, FeeBalance, Payment } from './types'

export const FREQUENCY_LABEL: Record<CoachPay['frequency'], string> = {
  semanal: 'por semana',
  quincenal: 'por quincena',
  mensual: 'por mes',
}

export const EXPENSE_FREQUENCY: Record<Expense['frequency'], { label: string; per: string }> = {
  semanal: { label: 'Cada semana', per: 'por semana' },
  quincenal: { label: 'Cada quincena', per: 'por quincena' },
  mensual: { label: 'Cada mes', per: 'por mes' },
  anual: { label: 'Una vez al año', per: 'al año' },
  unico: { label: 'Una sola vez', per: 'una vez' },
}

export const WEEKS_PER_MONTH = 52 / 12

/** Costo mensual de un sueldo según su frecuencia (semanal = 52 semanas / 12 meses). */
export function monthlyCost(pay: Pick<CoachPay, 'amount' | 'frequency'> | undefined | null) {
  if (!pay) return 0
  const a = Number(pay.amount)
  return pay.frequency === 'semanal' ? a * WEEKS_PER_MONTH : pay.frequency === 'quincenal' ? a * 2 : a
}

/**
 * Parte de un gasto que corresponde a un mes ('YYYY-MM').
 * Anual: se prorratea ÷12 para comparar meses de forma justa.
 * Único: completo en el mes en que se pagó.
 */
export function expenseForMonth(e: Pick<Expense, 'amount' | 'frequency' | 'paid_month' | 'paid_year' | 'active'>, month: string) {
  if (!e.active) return 0
  const a = Number(e.amount)
  switch (e.frequency) {
    case 'semanal': return a * WEEKS_PER_MONTH
    case 'quincenal': return a * 2
    case 'mensual': return a
    case 'anual': return a / 12
    case 'unico': {
      const [y, m] = month.split('-').map(Number)
      return e.paid_month === m && (!e.paid_year || e.paid_year === y) ? a : 0
    }
  }
}

export interface CategoryResult {
  id: string
  name: string
  students: number
  income: number
  scholarships: number
  generalExpenses: number
  salaries: number
  result: number
  coaches: { name: string; monthly: number; share: number }[]
}

/**
 * Ganancia real del mes por categoría:
 *   ingreso real (pagos recibidos en el mes de alumnos de la categoría)
 *   − gastos generales (su parte según número de alumnos activos)
 *   − sueldo del profesor (repartido entre sus categorías)
 * Las becas se muestran aparte: es dinero que no se recibió.
 * Los sueldos de profesores sin categoría se reparten como gasto general.
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
  expenses?: Expense[]
}) {
  const { month, categories, students, payments, fees, coaches, coachCategories, coachPay, expenses = [] } = opts
  const catOf = new Map(students.map((s) => [s.id, s.category_id]))
  const rows = new Map<string, CategoryResult>(
    categories.map((c) => [c.id, { id: c.id, name: c.name, students: 0, income: 0, scholarships: 0, generalExpenses: 0, salaries: 0, result: 0, coaches: [] }]),
  )
  let activeTotal = 0
  for (const s of students) {
    if (s.status !== 'activo') continue
    activeTotal++
    const r = s.category_id ? rows.get(s.category_id) : undefined
    if (r) r.students++
  }
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

  // Sueldos: a sus categorías; los que no tienen categoría pasan a gastos generales
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
      r.coaches.push({ name: c.full_name, monthly: cost, share: cats.length })
    }
  }

  const generalTotal = expenses.reduce((a, e) => a + expenseForMonth(e, month), 0) + unassignedSalaries
  const perStudent = activeTotal ? generalTotal / activeTotal : 0
  for (const r of rows.values()) r.generalExpenses = perStudent * r.students

  const list = [...rows.values()].map((r) => ({ ...r, result: r.income - r.generalExpenses - r.salaries }))
  const sum = (k: 'students' | 'income' | 'scholarships' | 'generalExpenses' | 'salaries') => list.reduce((a, r) => a + r[k], 0)
  const totals = {
    students: activeTotal,
    income: sum('income') + unassignedIncome,
    scholarships: sum('scholarships'),
    generalExpenses: generalTotal,
    salaries: sum('salaries'),
  }
  return {
    list,
    activeTotal,
    perStudent,
    generalTotal,
    unassignedIncome,
    unassignedSalaries,
    unassignedCoaches,
    totals: { ...totals, result: totals.income - totals.generalExpenses - totals.salaries },
  }
}
