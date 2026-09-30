import { addDays } from 'date-fns'
import { expenseEntries, loansReceived } from './finance'
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
