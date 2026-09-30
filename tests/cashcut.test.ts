import { describe, expect, it } from 'vitest'
import { carryOver, nextPeriodStart, periodSummary } from '../src/lib/cashcut'
import type { Expense, FeeBalance, Payment } from '../src/lib/types'

const exp = (p: Partial<Expense>): Expense => ({ id: p.name ?? 'x', name: 'x', amount: 0, frequency: 'mensual', paid_month: null, paid_year: null, down_payment: null, installments: null, paid_on: null, notes: null, active: true, sort_order: 0, ...p })
const pay = (id: string, paid_at: string, amount: number, method: Payment['method'] = 'efectivo') => ({ id, fee_id: 'f', student_id: 's', amount, paid_at, method }) as Payment

describe('corte de caja', () => {
  it('el siguiente corte empieza el día después del último', () => {
    expect(nextPeriodStart([], '2026-09-28')).toBe('2026-09-28')
    expect(nextPeriodStart([{ period_to: '2026-09-30' }, { period_to: '2026-09-23' }], 'x')).toBe('2026-10-01')
  })
  it('lo que se dejó en caja chica pasa al siguiente corte', () => {
    expect(carryOver({ distribution: [{ to: 'Caja chica', amount: 1500 }, { to: 'Ahorro Chivas', amount: 7500 }] })).toBe(1500)
    expect(carryOver(undefined)).toBe(0)
  })
  it('suma cobros y préstamos; resta sueldos del miércoles y pagos hechos, no los pendientes', () => {
    const inst = (n: number, due_date: string, amount: number, paid_on: string | null) => ({ id: `i${n}`, expense_id: 'x', n, due_date, amount, paid_on, notes: null })
    const d = periodSummary({
      from: '2026-10-01', to: '2026-10-07',
      payments: [pay('a', '2026-10-02', 550), pay('b', '2026-10-05', 600, 'transferencia'), pay('c', '2026-10-09', 550)],
      fees: [{ id: 'f', concept: 'Mensualidad' } as FeeBalance], names: new Map([['s', 'Juan']]),
      expenses: [
        exp({ name: 'Préstamo', kind: 'prestamo', lender: 'Pepe', amount: 5000, frequency: 'partes', received_on: '2026-10-03', expense_installments: [inst(1, '2026-11-03', 5000, null)] }),
        exp({ name: 'Playeras', amount: 4500, frequency: 'partes', expense_installments: [inst(1, '2026-10-02', 2250, '2026-10-02'), inst(2, '2026-10-06', 2250, null)] }),
      ],
      coaches: [{ id: 'c', full_name: 'Juan de Dios', active: true }], coachPay: [{ coach_id: 'c', amount: 700, frequency: 'semanal' }],
    })
    expect(d.inTotal).toBe(550 + 600 + 5000)
    expect(d.cashIn).toBe(550)
    expect(d.outs.map((o) => [o.date, o.amount])).toEqual([['2026-10-02', 2250], ['2026-10-07', 700]])
    expect(d.net).toBe(6150 - 2950)
  })
})
