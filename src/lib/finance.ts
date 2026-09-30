import type { Category, CoachPay, Expense, ExpenseInstallment, FeeBalance, Payment } from './types'

export const isLoan = (e: Pick<Expense, 'kind'>) => e.kind === 'prestamo'

/** Pagos registrados de un gasto en partes, en orden (o null si aún no tiene). */
export function installmentsOf(e: Pick<Expense, 'expense_installments'>) {
  const l = e.expense_installments
  return l && l.length ? [...l].sort((a, b) => a.n - b.n) : null
}
/** Fecha en que cuenta un pago: cuando se pagó, o cuando toca si está pendiente. */
export const installmentDate = (i: Pick<ExpenseInstallment, 'paid_on' | 'due_date'>) => i.paid_on ?? i.due_date
export function installmentLabel(i: Pick<ExpenseInstallment, 'n'>, all: Pick<ExpenseInstallment, 'n'>[]) {
  const last = Math.max(...all.map((x) => x.n))
  return i.n === 0 ? 'Anticipo' : `Pago ${i.n} de ${last}`
}

/** Pagos de gastos en partes pendientes que vencen a más tardar en `until` (incluye atrasados). */
export function pendingInstallments(expenses: Expense[], until: string) {
  return expenses.flatMap((e) => {
    const l = e.active ? installmentsOf(e) : null
    return (l ?? []).filter((i) => !i.paid_on && i.due_date <= until).map((i) => ({ expense: e, inst: i, label: installmentLabel(i, l!) }))
  }).sort((a, b) => a.inst.due_date.localeCompare(b.inst.due_date))
}

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
  partes: { label: 'En partes', per: 'por pago' },
}

export const WEEKS_PER_MONTH = 52 / 12

/** Costo mensual de un sueldo según su frecuencia (semanal = 52 semanas / 12 meses). */
export function monthlyCost(pay: Pick<CoachPay, 'amount' | 'frequency'> | undefined | null) {
  if (!pay) return 0
  const a = Number(pay.amount)
  return pay.frequency === 'semanal' ? a * WEEKS_PER_MONTH : pay.frequency === 'quincenal' ? a * 2 : a
}

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * Calendario de un gasto en partes: el anticipo cae en paid_month/paid_year
 * y el resto se divide en pagos mensuales iguales a partir del mes siguiente.
 * Sin anticipo, el primer pago cae en paid_month.
 */
export function installmentPlan(e: Pick<Expense, 'amount' | 'down_payment' | 'installments' | 'paid_month' | 'paid_year'>, fallbackYear = new Date().getFullYear()) {
  const total = Number(e.amount) || 0
  const down = Math.min(total, Math.max(0, Number(e.down_payment) || 0))
  const n = Math.max(1, Number(e.installments) || 1)
  const remaining = total - down
  const each = remaining / n
  const start = (e.paid_year ?? fallbackYear) * 12 + ((e.paid_month ?? 1) - 1)
  const at = (i: number) => ({ key: `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, label: `${MONTH_SHORT[i % 12]} ${String(Math.floor(i / 12)).slice(2)}` })
  const schedule = [
    ...(down > 0 ? [{ ...at(start), amount: down, kind: 'anticipo' as const, n: 0 }] : []),
    ...Array.from({ length: n }, (_, k) => ({ ...at(start + k + (down > 0 ? 1 : 0)), amount: each, kind: 'pago' as const, n: k + 1 })),
  ]
  return { total, down, remaining, n, each, schedule }
}

/**
 * Parte de un gasto que corresponde a un mes ('YYYY-MM').
 * Anual: se prorratea ÷12 para comparar meses de forma justa.
 * Único: completo en el mes en que se pagó.
 * En partes: el anticipo o el pago que cae en ese mes.
 */
export function expenseForMonth(e: Pick<Expense, 'amount' | 'frequency' | 'paid_month' | 'paid_year' | 'active' | 'down_payment' | 'installments' | 'expense_installments' | 'kind'>, month: string) {
  // Los préstamos no son gasto de operación (se devuelve dinero que ya entró)
  if (!e.active || isLoan(e)) return 0
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
    case 'partes': {
      const rows = installmentsOf(e)
      if (rows) return rows.filter((i) => installmentDate(i).startsWith(month)).reduce((s, i) => s + Number(i.amount), 0)
      return installmentPlan(e, Number(month.slice(0, 4))).schedule.filter((p) => p.key === month).reduce((s, p) => s + p.amount, 0)
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
  extraClasses?: { student_id: string; category_id: string }[]
}) {
  const { month, categories, students, payments, fees, coaches, coachCategories, coachPay, expenses = [], extraClasses = [] } = opts
  const extraIds = new Set(categories.filter((c) => c.is_extra).map((c) => c.id))
  const activeIds = new Set(students.filter((s) => s.status === 'activo').map((s) => s.id))
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
  // Un alumno en clase extra (p. ej. Porteros) reparte su pago en partes iguales entre
  // su categoría y cada clase extra; los gastos generales sólo se cargan en su categoría.
  const extrasOf = new Map<string, string[]>()
  for (const x of extraClasses) {
    if (!extraIds.has(x.category_id) || !rows.has(x.category_id)) continue
    extrasOf.set(x.student_id, [...(extrasOf.get(x.student_id) ?? []), x.category_id])
  }
  const shareOf = (studentId: string) => {
    const base = catOf.get(studentId)
    const cats = [...(base && rows.has(base) ? [base] : []), ...(extrasOf.get(studentId) ?? [])]
    return cats
  }
  for (const p of payments) {
    if (!p.paid_at.startsWith(month)) continue
    const cats = shareOf(p.student_id)
    if (!cats.length) { unassignedIncome += Number(p.amount); continue }
    for (const c of cats) rows.get(c)!.income += Number(p.amount) / cats.length
  }
  for (const f of fees) {
    if (!f.period.startsWith(month)) continue
    const cats = shareOf(f.student_id)
    for (const c of cats) rows.get(c)!.scholarships += Number(f.discount) / cats.length
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

  // Clases extra (p. ej. Porteros): cuentan a sus inscritos, pero no cargan gastos generales
  for (const x of extraClasses) {
    const r = rows.get(x.category_id)
    if (r && extraIds.has(x.category_id) && activeIds.has(x.student_id)) r.students++
  }
  const generalTotal = expenses.reduce((a, e) => a + expenseForMonth(e, month), 0) + unassignedSalaries
  const perStudent = activeTotal ? generalTotal / activeTotal : 0
  for (const r of rows.values()) r.generalExpenses = extraIds.has(r.id) ? 0 : perStudent * r.students

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

// ---------------------------------------------------------------------
// Desglose día a día, ahorro del seguro, inscripciones y descuentos
// ---------------------------------------------------------------------

/** Día en que se pagan los sueldos semanales (3 = miércoles). */
export const PAYDAY = 3
/** Los alumnos con esta fecha de ingreso son la lista con la que arrancó la temporada. */
export const SEASON_START = '2026-09-01'
/** Mes en que empieza a apartarse el dinero del seguro. */
export const INSURANCE_SAVING_START = '2026-10'

const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate()
const weekday = (y: number, m: number, d: number) => new Date(y, m - 1, d).getDay()

export interface ExpenseEntry {
  date: string
  name: string
  amount: number
  kind: 'sueldo' | 'fijo' | 'mes' | 'prestamo'
  detail: string
  /** Pago de gasto en partes que todavía no se hace */
  pending?: boolean
}

/**
 * Gastos reales de un mes, día por día:
 * sueldos semanales cada miércoles, quincenales el 15 y el último día,
 * mensuales el día 1, anuales completos en su mes, únicos en su fecha.
 */
export function expenseEntries(opts: {
  month: string
  expenses: Expense[]
  coaches: { id: string; full_name: string; active: boolean }[]
  coachPay: CoachPay[]
}): ExpenseEntry[] {
  const { month, expenses, coaches, coachPay } = opts
  const [y, m] = month.split('-').map(Number)
  const last = daysIn(y, m)
  const day = (d: number) => `${month}-${pad(Math.min(Math.max(d, 1), last))}`
  const out: ExpenseEntry[] = []
  const recurring = (name: string, amount: number, frequency: 'semanal' | 'quincenal' | 'mensual', kind: ExpenseEntry['kind'], detail: string) => {
    if (frequency === 'semanal') {
      for (let d = 1; d <= last; d++) if (weekday(y, m, d) === PAYDAY) out.push({ date: day(d), name, amount, kind, detail: `${detail} · semanal` })
    } else if (frequency === 'quincenal') {
      out.push({ date: day(15), name, amount, kind, detail: `${detail} · 1a quincena` }, { date: day(last), name, amount, kind, detail: `${detail} · 2a quincena` })
    } else out.push({ date: day(1), name, amount, kind, detail: `${detail} · mensual` })
  }
  for (const c of coaches) {
    if (!c.active) continue
    const p = coachPay.find((x) => x.coach_id === c.id)
    if (p && Number(p.amount) > 0) recurring(c.full_name, Number(p.amount), p.frequency, 'sueldo', 'Sueldo profesor')
  }
  for (const e of expenses) {
    if (!e.active || !(Number(e.amount) > 0)) continue
    const a = Number(e.amount)
    const onDay = e.paid_on && e.paid_on.startsWith(month) ? Number(e.paid_on.slice(8, 10)) : 1
    switch (e.frequency) {
      case 'semanal': case 'quincenal': case 'mensual':
        recurring(e.name, a, e.frequency, 'fijo', 'Gasto fijo'); break
      case 'anual':
        if (e.paid_month === m) out.push({ date: day(1), name: e.name, amount: a, kind: 'fijo', detail: 'Pago anual' }); break
      case 'unico':
        if (expenseForMonth(e, month) > 0) out.push({ date: day(onDay), name: e.name, amount: a, kind: 'mes', detail: 'Gasto del mes' }); break
      case 'partes': {
        const rows = installmentsOf(e)
        if (rows) {
          for (const i of rows.filter((x) => installmentDate(x).startsWith(month)))
            out.push({
              date: installmentDate(i), name: isLoan(e) ? `Préstamo · ${e.lender ?? e.name}` : e.name, amount: Number(i.amount), kind: isLoan(e) ? 'prestamo' : 'mes',
              detail: `${isLoan(e) ? 'Pago de préstamo · ' : ''}${installmentLabel(i, rows)}${i.paid_on ? '' : ' · pendiente'}`, pending: !i.paid_on,
            })
          break
        }
        for (const p of installmentPlan(e, y).schedule.filter((x) => x.key === month))
          out.push({ date: day(onDay), name: e.name, amount: p.amount, kind: 'mes', detail: p.kind === 'anticipo' ? 'Anticipo' : `Pago ${p.n} de ${Number(e.installments) || 1}` })
        break
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}

/**
 * Ahorro para el seguro anual: cada mes, a partir del mes siguiente a su pago,
 * se aparta 1/12 para tenerlo completo cuando vuelva a pagarse.
 */
export function insuranceSaving(expenses: Expense[], month: string) {
  const ins = expenses.find((e) => e.active && e.frequency === 'anual' && /seguro/i.test(e.name))
  if (!ins) return null
  const total = Number(ins.amount)
  const monthly = total / 12
  const payMonth = ins.paid_month ?? 9
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1)
  const cycleStart = idx - ((m - 1 - (payMonth % 12) + 12) % 12)
  const [sy, sm] = INSURANCE_SAVING_START.split('-').map(Number)
  const start = Math.max(cycleStart, sy * 12 + (sm - 1))
  const months = idx < start ? 0 : Math.min(12, idx - start + 1)
  const saved = monthly * months
  const dueIdx = cycleStart + 11
  return {
    name: ins.name, total, monthly, months, saved, remaining: total - saved,
    startsIn: start > idx ? MONTH_SHORT[start % 12] : null,
    dueLabel: `${MONTH_SHORT[dueIdx % 12]} ${Math.floor(dueIdx / 12)}`,
  }
}

/** Alumno nuevo en el mes (no cuenta la lista con la que arrancó la temporada). */
export const isNewEnrollment = (s: { enrolled_at: string | null }, month: string) =>
  !!s.enrolled_at && s.enrolled_at.startsWith(month) && s.enrolled_at !== SEASON_START

export type DiscountKind = 'beca' | 'hermanos' | 'descuento'
export const DISCOUNT_LABEL: Record<DiscountKind, string> = { beca: 'Becas', hermanos: 'Promo hermanos', descuento: 'Descuentos' }
export function discountKind(reason: string | null): DiscountKind {
  if (reason?.startsWith('Descuento')) return 'descuento'
  if (reason && /hermano/i.test(reason)) return 'hermanos'
  return 'beca'
}

/** Becas y descuentos de las cuotas de un mes, separados por tipo. */
export function discountsFor(fees: Pick<FeeBalance, 'discount' | 'discount_reason' | 'student_id'>[]) {
  const by: Record<DiscountKind, number> = { beca: 0, hermanos: 0, descuento: 0 }
  const kids = new Set<string>()
  for (const f of fees) {
    const d = Number(f.discount)
    if (!(d > 0)) continue
    by[discountKind(f.discount_reason)] += d
    kids.add(f.student_id)
  }
  return { total: by.beca + by.hermanos + by.descuento, by, students: kids.size }
}

/** Préstamos que entraron entre dos fechas (dinero que llegó a Rancho Seco). */
export function loansReceived(expenses: Expense[], from: string, to: string) {
  return expenses.filter((e) => isLoan(e) && e.received_on && e.received_on >= from && e.received_on <= to)
}

/** Resumen de un préstamo: cuánto se ha devuelto, cuánto falta y el siguiente pago. */
export function loanStatus(e: Expense) {
  const rows = installmentsOf(e) ?? []
  const paid = rows.filter((i) => i.paid_on).reduce((a, i) => a + Number(i.amount), 0)
  const total = Number(e.amount)
  const next = rows.find((i) => !i.paid_on) ?? null
  return { total, paid, remaining: Math.max(0, total - paid), next, rows, done: rows.length > 0 && !next }
}
