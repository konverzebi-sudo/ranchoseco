import type { FeeBalance } from './types'

type Open = Pick<FeeBalance, 'id' | 'concept' | 'period' | 'due_date' | 'balance'>

/** Primero se paga lo que venció antes; en el mismo mes, inscripciones antes que la mensualidad. */
export function payOrder(a: Open, b: Open) {
  const rank = (c: string) => (/^inscrip|^reinscrip/i.test(c) ? 0 : /^mensual/i.test(c) ? 1 : 2)
  return a.due_date.localeCompare(b.due_date) || a.period.localeCompare(b.period) || rank(a.concept) - rank(b.concept)
}

/**
 * Reparte un pago entre lo que debe el alumno: primero lo más antiguo.
 * Lo que sobre después de liquidar todo queda en `rest` (se puede abonar por adelantado).
 */
export function allocatePayment(open: Open[], amount: number) {
  let left = Math.round(amount * 100) / 100
  const parts: { fee: Open; amount: number; settles: boolean }[] = []
  for (const f of [...open].filter((x) => Number(x.balance) > 0).sort(payOrder)) {
    if (left <= 0) break
    const take = Math.min(left, Number(f.balance))
    parts.push({ fee: f, amount: Math.round(take * 100) / 100, settles: take >= Number(f.balance) })
    left = Math.round((left - take) * 100) / 100
  }
  return { parts, rest: left }
}
