import { addDays } from 'date-fns'
import { expenseEntries, installmentLabel, installmentsOf, isLoan, loanStatus, loansReceived } from './finance'
import { toISODate } from './format'
import type { CashCut, CoachPay, Expense, FeeBalance, Payment, PaymentMethod } from './types'

/** Lo que se aparta en este destino se queda en caja para el siguiente corte. */
export const CARRY_DESTINATION = 'Caja chica'
export const DESTINATIONS = ['Caja chica', 'Ahorro Chivas', 'Ahorro seguro', 'Banco', 'Pago a profesores', 'Pago de préstamo', 'Dueño', 'Otro']

const nextDay = (d: string) => toISODate(addDays(new Date(d + 'T12:00:00'), 1))

/** El siguiente corte empieza el día después del último corte. */
export function nextPeriodStart(cuts: Pick<CashCut, 'period_to'>[], fallback: string) {
  const last = cuts.reduce<string | null>((m, c) => (!m || c.period_to > m ? c.period_to : m), null)
  return last ? nextDay(last) : fallback
}

/** Dinero que se quedó en caja chica en el corte anterior (con qué se empieza). */
export function carryOver(prev: Pick<CashCut, 'distribution'> | undefined) {
  return (prev?.distribution ?? []).filter((d) => d.to.trim().toLowerCase() === CARRY_DESTINATION.toLowerCase()).reduce((a, d) => a + Number(d.amount), 0)
}

/**
 * Lo que entró y salió entre dos fechas:
 * entradas = cobros a alumnos + préstamos recibidos;
 * salidas = sueldos, gastos y pagos de préstamos (los pagos en partes pendientes no cuentan).
 */
export function periodSummary(opts: {
  from: string; to: string
  payments: Payment[]; fees: FeeBalance[]; names: Map<string, string>
  expenses: Expense[]; coaches: { id: string; full_name: string; active: boolean }[]; coachPay: CoachPay[]
}) {
  const { from, to, payments, fees, names, expenses, coaches, coachPay } = opts
  const feeMap = new Map(fees.map((f) => [f.id, f]))
  const ins = payments.filter((p) => p.paid_at.slice(0, 10) >= from && p.paid_at.slice(0, 10) <= to).map((p) => {
    const f = feeMap.get(p.fee_id)
    return { ...p, day: p.paid_at.slice(0, 10), student: names.get(p.student_id) ?? '—', concept: f ? `${f.concept}` : 'Pago', kind: f?.concept ?? 'Otro' }
  }).sort((a, b) => a.day.localeCompare(b.day) || a.student.localeCompare(b.student))
  const loans = loansReceived(expenses, from, to)
  const months = new Set<string>()
  for (let d = from; d <= to; d = nextDay(d)) months.add(d.slice(0, 7))
  const outs = [...months].flatMap((month) => expenseEntries({ month, expenses, coaches, coachPay }))
    .filter((e) => e.date >= from && e.date <= to && !e.pending)
  const byMethod = new Map<PaymentMethod, { n: number; total: number }>()
  for (const p of ins) { const r = byMethod.get(p.method) ?? { n: 0, total: 0 }; r.n++; r.total += Number(p.amount); byMethod.set(p.method, r) }
  const byKind = new Map<string, { n: number; total: number }>()
  for (const p of ins) { const r = byKind.get(p.kind) ?? { n: 0, total: 0 }; r.n++; r.total += Number(p.amount); byKind.set(p.kind, r) }
  const loansIn = loans.reduce((a, e) => a + Number(e.amount), 0)
  const inTotal = ins.reduce((a, p) => a + Number(p.amount), 0) + loansIn
  const outTotal = outs.reduce((a, e) => a + e.amount, 0)
  return {
    ins, outs, loans, loansIn, inTotal, outTotal, net: inTotal - outTotal,
    cashIn: byMethod.get('efectivo')?.total ?? 0,
    byMethod: [...byMethod.entries()], byKind: [...byKind.entries()].sort((a, b) => b[1].total - a[1].total),
  }
}

// ---------------------------------------------------------------------
// Revisión de cada línea del corte y sugerencias de ahorro
// ---------------------------------------------------------------------

/** Una entrada o salida del corte: se aprueba con ✓ o se corrige con nota. */
export interface CutItem {
  key: string
  type: 'entrada' | 'salida'
  date: string
  concept: string
  detail: string
  amount: number
  approved: boolean
  adjusted: number | null
  note: string
  /** No salió (o no entró) por la caja: se pagó por otro lado, no cuenta en el corte */
  excluded?: boolean
}
export const itemValue = (i: Pick<CutItem, 'amount' | 'adjusted'>) => (i.adjusted ?? i.amount)

/** Líneas del corte a partir del resumen del periodo (conserva lo ya revisado por clave). */
export function buildItems(d: ReturnType<typeof periodSummary>, prev: CutItem[] = []): CutItem[] {
  const kept = new Map(prev.map((i) => [i.key, i]))
  const base: Omit<CutItem, 'approved' | 'adjusted' | 'note'>[] = [
    ...d.ins.map((p) => ({ key: `p:${p.id}`, type: 'entrada' as const, date: p.day, concept: p.student, detail: `${p.concept} · ${p.method}`, amount: Number(p.amount) })),
    ...d.loans.map((e) => ({ key: `l:${e.id}`, type: 'entrada' as const, date: e.received_on ?? '', concept: `Préstamo de ${e.lender ?? ''}`.trim(), detail: 'Préstamo recibido', amount: Number(e.amount) })),
    ...d.outs.map((e) => ({ key: `o:${e.date}:${e.name}:${e.detail}`, type: 'salida' as const, date: e.date, concept: e.name, detail: e.detail, amount: e.amount })),
  ]
  return base.map((b) => {
    const k = kept.get(b.key)
    return { ...b, approved: k?.approved ?? false, adjusted: k?.adjusted ?? null, note: k?.note ?? '', excluded: k?.excluded ?? false }
  })
}

export function itemTotals(items: CutItem[]) {
  const sum = (t: CutItem['type']) => items.filter((i) => i.type === t && !i.excluded).reduce((a, i) => a + itemValue(i), 0)
  return { income: sum('entrada'), outflow: sum('salida'), pending: items.filter((i) => !i.approved).length, adjusted: items.filter((i) => i.adjusted != null).length }
}

/** Algo que hay que ir juntando: un gasto grande, una parte pendiente o un pago de préstamo. */
export interface SavingFund {
  key: string
  name: string
  kind: 'fijo' | 'seguro' | 'parte' | 'prestamo'
  target: number
  due: string
  /** Lo que ya se apartó en cortes anteriores para este mismo pago */
  saved: number
  weeksLeft: number
  suggested: number
  debt?: { total: number; paid: number }
}

const DAY = 86_400_000
const toDate = (d: string) => new Date(d + 'T12:00:00')

/** Siguiente fecha de pago (después del corte) de un gasto fijo. */
function nextDue(e: Expense, after: string): string | null {
  const a = toDate(after)
  const iso = (y: number, m: number, d: number) => toISODate(new Date(y, m, d, 12))
  if (e.frequency === 'mensual') return iso(a.getFullYear(), a.getMonth() + 1, 1)
  if (e.frequency === 'quincenal') {
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()
    return a.getDate() < 15 ? iso(a.getFullYear(), a.getMonth(), 15) : a.getDate() < last ? iso(a.getFullYear(), a.getMonth(), last) : iso(a.getFullYear(), a.getMonth() + 1, 15)
  }
  if (e.frequency === 'anual') {
    const m = (e.paid_month ?? 1) - 1
    const thisYear = iso(a.getFullYear(), m, 1)
    return thisYear > after ? thisYear : iso(a.getFullYear() + 1, m, 1)
  }
  return null
}

/**
 * Sugerencias de ahorro para el corte: lo que falta de cada pago grande
 * se reparte entre las semanas que quedan (Regalías $7,500 a 4 semanas = $1,875 por semana).
 */
export function savingFunds(opts: { cutDate: string; expenses: Expense[]; cuts: Pick<CashCut, 'id' | 'savings'>[]; excludeCut?: string }): SavingFund[] {
  const { cutDate, expenses, cuts, excludeCut } = opts
  const savedFor = (key: string) => cuts.filter((c) => c.id !== excludeCut)
    .flatMap((c) => c.savings ?? []).filter((s) => s.key === key).reduce((a, s) => a + Number(s.saved), 0)
  const fund = (f: Omit<SavingFund, 'saved' | 'weeksLeft' | 'suggested'>): SavingFund => {
    const saved = savedFor(f.key)
    const weeksLeft = Math.max(1, Math.ceil((toDate(f.due).getTime() - toDate(cutDate).getTime()) / (7 * DAY)))
    const suggested = Math.max(0, Math.round(((f.target - saved) / weeksLeft) * 100) / 100)
    return { ...f, saved, weeksLeft, suggested }
  }
  const out: SavingFund[] = []
  for (const e of expenses) {
    if (!e.active) continue
    if (!isLoan(e) && ['mensual', 'quincenal', 'anual'].includes(e.frequency)) {
      const due = nextDue(e, cutDate)
      if (due) out.push(fund({ key: `f:${e.id}:${due}`, name: e.name, kind: /seguro/i.test(e.name) ? 'seguro' : 'fijo', target: Number(e.amount), due }))
      continue
    }
    const next = (installmentsOf(e) ?? []).find((i) => !i.paid_on)
    if (!next) continue
    const label = installmentLabel(next, installmentsOf(e)!)
    if (isLoan(e)) {
      const st = loanStatus(e)
      out.push(fund({ key: `i:${next.id}`, name: `Préstamo de ${e.lender ?? e.name} · ${label}`, kind: 'prestamo', target: Number(next.amount), due: next.due_date, debt: { total: st.total, paid: st.paid } }))
    } else {
      out.push(fund({ key: `i:${next.id}`, name: `${e.name} · ${label}`, kind: 'parte', target: Number(next.amount), due: next.due_date }))
    }
  }
  const order = { fijo: 0, seguro: 1, parte: 2, prestamo: 3 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.due.localeCompare(b.due))
}
